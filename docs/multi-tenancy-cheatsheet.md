# Qdrant Multi-Tenancy Cheat Sheet

## TL;DR — best-practice config

```python
client.create_collection(
    "kb",
    vectors_config=VectorParams(size=384, distance=Distance.COSINE),
    hnsw_config=models.HnswConfigDiff(
        m=0,            # 0 = no global graph (or 8 if you ALSO need cross-tenant search)
        payload_m=16,   # per-tenant HNSW sub-graphs
    ),
)
client.create_payload_index("kb", "tenant_id",
    field_schema=models.KeywordIndexParams(type="keyword", is_tenant=True))
client.create_payload_index("kb", "created_at",
    field_schema=models.IntegerIndexParams(type="integer", is_principal=True))
# every search MUST include: Filter(must=[FieldCondition(key="tenant_id", match=MatchValue(value=tid))])
```

That single config gives you: tenant-co-located disk layout, per-tenant HNSW graphs, fast range queries on the principal axis, and a structural place to enforce isolation.

---

## The three strategies at a glance

| Strategy | When | Config | Trade-off |
|---|---|---|---|
| **Optimized payload** (default choice) | < 1000 tenants, similar sizes | one collection · `is_tenant: true` · `m=0, payload_m=16` | best perf for tenant-scoped search; cross-tenant search effectively gone |
| **Hybrid graph** | Need both tenant + cross-tenant search | one collection · `is_tenant: true` · `m=8, payload_m=16` | small cost in build time + RAM, keeps global queries usable |
| **Custom sharding** | Huge tenants, region/compliance split, "one tenant = 90% of data" | `sharding_method: custom`, dedicated shards for big tenants, shared `default` for small | most isolation; manual ops (shard create/promote, ID-space gotcha) |

Don't pick "many small collections — one per tenant". That's [the anti-pattern that kills clusters](https://kulekci.medium.com/why-more-collections-might-be-killing-your-qdrant-cluster-797364cb4bbb).

---

## What happens if you skip each piece

| Skip / mistake | What still works | What breaks or degrades |
|---|---|---|
| **Collection per tenant** | Isolation is bulletproof | Each collection has its own segments, optimizer state, metadata, RAM overhead. Past ~dozens of tenants the cluster spends more time on housekeeping than on search. |
| **Keyword index without `is_tenant: true`** | Filter results are correct | Disk layout mixes tenants → cold-cache reads do a lot of random IO. Search latency variance grows with tenant count. |
| **`is_tenant: true` but HNSW left at default** | Filter results are correct, disk layout good | Global graph still built across all tenants. Every filtered search walks neighbors from other tenants and discards them. CPU waste scales with tenant count. |
| **`m=0` without `payload_m`** | — | No graph at all → falls back to brute-force search. Latency goes up linearly with collection size. |
| **`m=0` with `payload_m=16`, but you needed cross-tenant search** | Tenant-scoped search is fast | Search without a tenant filter returns garbage / nothing useful — there is no global graph to traverse. |
| **Custom sharding without `is_tenant`** | Shard isolation works | Inside any shard with multiple tenants (e.g. shared `default`), HNSW still walks the global graph. |
| **Forgetting the tenant filter in *one* code path** | — | **Tenant data leak**. The single biggest risk in multi-tenancy. Make the filter structural (a `TenantScopedSearch` class, RBAC at the API layer). |
| **Custom sharding + upsert with new shard_key but no delete from old** | — | **Silent duplicates**. Each shard has its own ID space. Tenant promotion order: insert into new shard → verify → delete from old. |
| **`is_principal` on a keyword field** | Index works | Flag is silently ignored. `is_principal` is only meaningful on integer / float / datetime / uuid indexes. |
| **No payload index on tenant field** | — | Every filtered search becomes a full-collection scan. Effectively unusable past a few thousand points. |
| **Single shared `default` shard for everything at scale** | Works for small tenants | Shard becomes hot, segments grow huge, optimizer falls behind. |
| **`payload_m=16` but tenant cardinality is huge (millions of tiny tenants)** | Per-tenant graphs work | Memory overhead per tenant adds up. Consider grouping tiny tenants into "buckets" and use the bucket as the tenant key. |

---

## Decision tree

```
Need cross-tenant search (admin dashboards, global analytics)?
├── No  → m=0,  payload_m=16
└── Yes → m=8,  payload_m=16  (hybrid)

Tenant size distribution?
├── Roughly equal, < 1000 tenants     → no custom sharding
├── A few whales (>1M pts each)       → custom shard per whale + shared "default"
└── Region / compliance constraints   → custom shard per region
```

```
Filter field flags
├── tenant_id (keyword)              → is_tenant=true
├── created_at, updated_at,
│   timestamp (integer/datetime)     → is_principal=true
└── everything else                  → plain index, no flags
```

---

## Footguns checklist (review before shipping)

- [ ] Tenant filter is enforced in a single chokepoint, not at every call site.
- [ ] Reads, writes, deletes, and `scroll` all carry the tenant filter.
- [ ] If using custom sharding: every `upsert`/`search`/`scroll`/`delete` passes `shard_key_selector`.
- [ ] Tenant promotion procedure is **insert-then-delete**, never the other way.
- [ ] You actually verified `is_tenant` / `is_principal` were saved (`GET /collections/{name}` returns the flags) — keyword fields silently drop `is_principal`.
- [ ] You picked `m=0` vs `m=8` *consciously*, not by leaving the default.
- [ ] Monitoring: per-tenant point count, segment count per shard, optimizer queue.

---

## Plugin signal mapping

What the chrome plugin's badge tells you, mapped to the table above:

| Badge | Meaning |
|---|---|
| `tenant-opt` (green) | best-practice payload-based, `m=0` or `payload_m>0` |
| `tenant-opt` + `hybrid graph` pill | best-practice + cross-tenant capable |
| `tenant` (yellow) | `is_tenant=true` set but HNSW not tuned — half-done |
| `sharded+tenant` (green) | custom sharding done right |
| `sharded` (blue) | custom sharding, no `is_tenant` — fix in Insights tab |
| no badge | either not multi-tenant, or doing it without `is_tenant` (basic payload filtering — invisible to the detector by design) |

---

## References

- [Qdrant — Multi-Tenancy article](https://qdrant.tech/articles/multitenancy/)
- [Multi-Tenant Vector Search in Practice](https://kulekci.medium.com/multi-tenant-vector-search-in-practice-building-a-shared-knowledge-base-with-qdrant-7b7928ba00fe)
- [Why More Collections Might Be Killing Your Qdrant Cluster](https://kulekci.medium.com/why-more-collections-might-be-killing-your-qdrant-cluster-797364cb4bbb)
- [Companion notebook (gist)](https://gist.github.com/hkulekci/b2818e86af5b60f307302532993d59d6)
