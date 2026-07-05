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

## Installation

### From Release

1. Download the latest `.zip` from [Releases](../../releases)
2. Unzip the file
3. Open `chrome://extensions` in Chrome
4. Enable **Developer mode** (top right toggle)
5. Click **Load unpacked** and select the unzipped folder

### From Source

1. Clone the repository:
   ```bash
   git clone https://github.com/qdrant/qdrant-chrome-plugin.git
   ```
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode**
4. Click **Load unpacked** and select the repository folder

## Usage

1. Click the extension icon in Chrome toolbar
2. Click **+** to add a cluster (name, URL, API key)
3. Use **Test** to verify the connection
4. Click **Save**, then click on the cluster to open the dashboard

### Dashboard Tabs

- **Overview** - System information (version, OS, CPU, RAM, disk) and memory usage breakdown
- **Collections** - Detailed configuration for each collection with inline insight badges
- **Shards & Segments** - Per-shard node distribution with segment details (type, storage, index config)
- **Cluster** - Peer nodes, Raft consensus status
- **Requests** - REST/gRPC endpoint statistics sorted by request count

## Qdrant API Endpoints Used

| Endpoint | Purpose |
|---|---|
| `GET /healthz` | Connection health check |
| `GET /cluster` | Cluster topology, peers, Raft status |
| `GET /collections` | List all collections |
| `GET /collections/{name}` | Collection config, status, payload schema |
| `GET /collections/{name}/cluster` | Shard distribution for a collection |
| `GET /telemetry?details_level=10` | System info, memory, segments, request stats |

## Project Structure

```
├── manifest.json                 # Chrome Extension Manifest V3
├── lib/
│   ├── storage.js                # chrome.storage.local helper
│   └── qdrant-api.js             # Qdrant REST API client
├── popup/
│   ├── popup.html/css/js         # Cluster connection management
├── dashboard/
│   ├── dashboard.html/css/js     # Main dashboard UI
│   └── rules/
│       ├── rule-engine.js        # Rule registry, runner, renderer
│       ├── cluster-rules.js      # Cluster-level rules (memory, raft, consensus)
│       ├── collection-rules.js   # Collection-level rules (config, performance)
│       └── segment-rules.js      # Shard/segment-level rules (replicas, optimizer)
├── icons/                        # Extension icons
└── poc/                          # Proof of concept (not included in extension)
```

## Releasing

Releases are automated via GitHub Actions. To create a new release:

```bash
git tag v0.1.0
git push origin v0.1.0
```

This creates a GitHub Release with a `.zip` file ready for Chrome Web Store upload.

## Credits

The **Visualizer** tab reconstructs and animates an HNSW graph from real
collection vectors. Its graph engine and Canvas renderer are adapted from
[VectorLens — HNSW Vector Search Visualizer](https://github.com/ManikBodamwad/HNSW_Vector_Search_Visualizer)
by Manik Bodamwad (MIT). See [NOTICE](NOTICE) for the full attribution.

## License

Apache License 2.0
