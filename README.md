# Qdrant Cluster Dashboard - Chrome Extension

A Chrome extension for monitoring and managing Qdrant vector database clusters. Connect to one or more Qdrant instances and get real-time visibility into cluster health, collection configurations, shard distribution, and performance insights.

## Features

- **Multi-cluster support** - Connect to multiple Qdrant clusters with URL + API key
- **Cluster overview** - Node count, collection count, memory usage, CPU, uptime
- **Collection details** - Dense/sparse vector configs, HNSW parameters, optimizer settings, quantization, payload indexes
- **Shard & segment visibility** - Per-node shard status, segment details (type, points, vectors, RAM/disk usage, storage config)
- **Raft consensus monitoring** - Term, commit, pending operations, leader/follower roles
- **Request statistics** - REST/gRPC endpoint latency (avg/min/max), request counts
- **Rule-based insights engine** - Automatic detection of performance issues and configuration recommendations
- **Vector Explorer** - Sample real vectors and *see* your embedding space in 2D (PCA or UMAP), colour by payload, auto-labelled clusters, server-side faceted filtering, and lasso isolation ([details](#vector-explorer))

## Insights & Recommendations

The extension includes a pluggable rule engine that analyzes your cluster configuration and produces actionable insights:

| Category | Examples |
|---|---|
| **Memory** | High resident memory usage, quantized vectors in RAM |
| **Optimizer** | Optimizer errors, high segment count, large update queue |
| **Replication** | No replication configured, dead replicas, recovery in progress |
| **Config** | Missing quantization, no payload indexes, HNSW on disk, prevent_unoptimized disabled |
| **Indexing** | Indexing progress, high deleted vector ratio |
| **Cluster** | Single-node cluster, Raft pending operations, consensus issues |

Rules are easy to extend - see [Contributing](#adding-new-rules).

## Vector Explorer

Sample real vectors from a collection and project them to 2D so you can explore the shape of your embedding space directly in the browser — no server-side compute, no external services.

- **Two projections** — **PCA** (default; fast, linear, good for global structure) and **UMAP** (opt-in; preserves local neighbourhoods, so points that are truly similar sit close together). Switch live from the toolbar. UMAP runs client-side with [umap-js](https://github.com/PAIR-code/umap-js) (pure JS — no WASM/eval, safe under the MV3 CSP) and is loaded on demand.
- **Nebula render** — additive-glow Canvas so dense regions read as bright cores.
- **Auto region labels** — distinctive TF-IDF terms per cluster, shown on the map and mirrored in the legend.
- **Nearest neighbours** — click a point to light up its closest neighbours (cosine) with connector lines; a long line means the projection stretched a true neighbour far away, so line length doubles as a projection-faithfulness cue.
- **Server-side faceted filtering** — facets and counts come from Qdrant's native [Facet API](https://qdrant.tech/documentation/concepts/search/#faceting) (exact, whole-collection). Click values in compact multi-select dropdowns (numeric/datetime use min–max ranges) to run a live Qdrant query on the matching subset and re-project it.
- **Lasso isolation** — draw a region, then *Isolate* to re-project just those points on their own and drill into a sub-cluster (runs locally on already-fetched vectors — instant and exact).
- **Educational HNSW visualizer** — a collapsible section reconstructs an HNSW graph from the real vectors and animates a nearest-neighbour search over it.

## Installation

### From Release

1. Download the latest `.zip` from [Releases](../../releases)
2. Unzip the file
3. Open `chrome://extensions` in Chrome
4. Enable **Developer mode** (top right toggle)
5. Click **Load unpacked** and select the unzipped folder

### From Source

1. Clone the repository and build:
   ```bash
   git clone https://github.com/hkulekci/qdrant-chrome-plugin.git
   cd qdrant-chrome-plugin
   npm install
   npm run build
   ```
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode**
4. Click **Load unpacked** and select the generated `dist/` folder

## Usage

1. Click the extension icon in Chrome toolbar
2. Click **+** to add a cluster (name, URL, API key)
3. Use **Test** to verify the connection — it calls an authenticated endpoint, so an invalid or expired API key is reported as a real `403` instead of a false success
4. Click **Save**, then click on the cluster to open the dashboard

All API requests are sent with `credentials: 'omit'`, so the extension never attaches (or overwrites) the target domain's cookies — Qdrant Cloud requests won't fail with `403 InvalidSignature`, and a Cloud UI session open in the same browser is left untouched. Authentication is carried solely by the `api-key` header.

### Dashboard Tabs

- **Overview** - System information (version, OS, CPU, RAM, disk) and memory usage breakdown
- **Collections** - Detailed configuration for each collection with inline insight badges
- **Shard Distribution** - Per-shard node distribution with segment details (type, storage, index config)
- **Optimizations** - Optimizer status and queued/completed optimizations
- **Transfers** - In-flight shard transfers and resharding operations
- **Cluster** - Peer nodes, Raft consensus status
- **Requests** - REST/gRPC endpoint statistics sorted by request count
- **Vector Explorer** - 2D embedding map with PCA/UMAP, faceted filtering and lasso isolation ([details](#vector-explorer))
- **Insights** - All rule-engine findings, filterable by level/category
- **Upgrade** - Appears when a newer known Qdrant version is available, with an upgrade plan

## Qdrant API Endpoints Used

| Endpoint | Purpose |
|---|---|
| `GET /healthz` | Connection health check |
| `GET /cluster` | Cluster topology, peers, Raft status |
| `GET /collections` | List all collections |
| `GET /collections/{name}` | Collection config, status, payload schema |
| `GET /collections/{name}/cluster` | Shard distribution for a collection |
| `GET /collections/{name}/optimizations` | Queued/completed optimizations |
| `GET /telemetry?details_level=10` | System info, memory, segments, request stats |
| `POST /collections/{name}/points/scroll` | Sample points + vectors for the Vector Explorer |
| `POST /collections/{name}/facet` | Exact facet counts for a payload field (Vector Explorer filters) |
| `PATCH /collections/{name}` | Trigger re-optimization (re-apply optimizer config) |

## Tech Stack

React 19 + TypeScript, built with Vite into a Manifest V3 extension. No runtime backend — everything runs client-side against the Qdrant REST API.

## Project Structure

```
├── public/manifest.json          # Chrome Extension Manifest V3
├── src/
│   ├── lib/
│   │   ├── storage.ts            # chrome.storage.local helper
│   │   ├── qdrant-api.ts         # Qdrant REST API client
│   │   └── hnsw/                 # 2D projection (PCA), UMAP, HNSW graph engine
│   ├── popup/                    # Cluster connection management (add/edit/test)
│   ├── dashboard/
│   │   ├── Dashboard.tsx         # Tab shell
│   │   ├── tabs/                 # Overview, Collections, …, VectorExplorer, Insights
│   │   └── viz/                  # VectorScatter (Canvas), FilterBuilder
│   └── rules/                    # Pluggable insight rules (cluster/collection/segment)
└── .github/workflows/release.yml # Tag-triggered build & GitHub Release
```

## Releasing

Releases are automated via GitHub Actions. To create a new release:

```bash
git tag v0.1.0
git push origin v0.1.0
```

This creates a GitHub Release with a `.zip` file ready for Chrome Web Store upload.

## Credits

The educational HNSW visualizer inside the **Vector Explorer** tab reconstructs
and animates an HNSW graph from real collection vectors. Its graph engine and
Canvas renderer are adapted from
[VectorLens — HNSW Vector Search Visualizer](https://github.com/ManikBodamwad/HNSW_Vector_Search_Visualizer)
by Manik Bodamwad (MIT). See [NOTICE](NOTICE) for the full attribution.

## License

Apache License 2.0
