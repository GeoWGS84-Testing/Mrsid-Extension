async function init() {
    let backendUrl = "https://api.geowgs84.com"; // Default fallback
    try {
        const stored = await new Promise(resolve => chrome.storage.local.get("backendUrl", resolve));
        if (stored && stored.backendUrl) {
            backendUrl = stored.backendUrl;
        } else {
            const envRes = await fetch(chrome.runtime.getURL(".env"));
            if (envRes.ok) {
                const text = await envRes.text();
                const match = text.match(/^BACKEND_URL\s*=\s*(.+)$/m);
                if (match && match[1]) {
                    backendUrl = match[1].trim();
                }
            }
        }
    } catch (e) {
        console.error("Could not load backend URL configuration:", e);
    }
    backendUrl = backendUrl.replace(/\/$/, "");

    const result = await new Promise(resolve => {
        chrome.storage.local.get("mapDataList", resolve);
    });
    let dataList = result.mapDataList || [];

    // Self-healing: Fetch fresh metadata, center, and bounds for all layers
    if (dataList.length > 0) {
        const freshDataList = await Promise.all(dataList.map(async (item) => {
            try {
                const res = await fetch(`${backendUrl}/metadata`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ filename: item.filename })
                });
                if (res.ok) {
                    const freshMeta = await res.json();
                    if (freshMeta && freshMeta.metadata_json) {
                        return {
                            ...item,
                            center: freshMeta.center || item.center,
                            bounds: freshMeta.bounds || item.bounds,
                            fullMetadata: freshMeta.metadata_json
                        };
                    }
                }
            } catch (e) {
                console.error("[GRID DEBUG] Failed to fetch fresh metadata for:", item.filename, e);
            }
            return item;
        }));
        dataList = freshDataList;
        // Save the updated list back to storage so subsequent views/popup also have the updated bounds
        await new Promise(resolve => {
            chrome.storage.local.set({ mapDataList: dataList }, resolve);
        });
    }

    // --- Async TIFF Download Helpers ---
    function showPreparingOverlay(filename, job_id, abortController) {
        const existing = document.getElementById("prepOverlay");
        if (existing) existing.remove();

        const overlay = document.createElement("div");
        overlay.id = "prepOverlay";
        overlay.style.position = "fixed";
        overlay.style.top = "0";
        overlay.style.left = "0";
        overlay.style.width = "100vw";
        overlay.style.height = "100vh";
        overlay.style.background = "rgba(10, 14, 20, 0.85)";
        overlay.style.backdropFilter = "blur(8px)";
        overlay.style.display = "flex";
        overlay.style.flexDirection = "column";
        overlay.style.alignItems = "center";
        overlay.style.justifyContent = "center";
        overlay.style.zIndex = "99999";
        overlay.style.color = "white";
        overlay.style.fontFamily = "'Inter', 'Outfit', sans-serif";

        const content = document.createElement("div");
        content.style.background = "#131924";
        content.style.padding = "30px 40px";
        content.style.borderRadius = "12px";
        content.style.border = "1px solid rgba(110, 231, 183, 0.2)";
        content.style.boxShadow = "0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 10px 10px -5px rgba(0, 0, 0, 0.4)";
        content.style.display = "flex";
        content.style.flexDirection = "column";
        content.style.alignItems = "center";
        content.style.gap = "20px";
        content.style.maxWidth = "450px";
        content.style.textAlign = "center";

        const spinner = document.createElement("div");
        spinner.style.width = "50px";
        spinner.style.height = "50px";
        spinner.style.border = "3px solid rgba(110, 231, 183, 0.1)";
        spinner.style.borderTop = "3px solid #6ee7b7";
        spinner.style.borderRadius = "50%";
        spinner.animate([
            { transform: 'rotate(0deg)' },
            { transform: 'rotate(360deg)' }
        ], {
            duration: 1000,
            iterations: Infinity
        });

        const title = document.createElement("div");
        title.style.fontSize = "1.2rem";
        title.style.fontWeight = "bold";
        title.style.color = "#6ee7b7";
        title.textContent = "Preparing Export";

        const msg = document.createElement("div");
        msg.style.fontSize = "0.9rem";
        msg.style.color = "#9ca3af";
        msg.style.lineHeight = "1.4";
        msg.textContent = `Extracting high-resolution TIFF for "${filename}". This can take a few moments...`;

        const cancelBtn = document.createElement("button");
        cancelBtn.style.padding = "10px 20px";
        cancelBtn.style.background = "rgba(239, 68, 68, 0.2)";
        cancelBtn.style.border = "1px solid rgba(239, 68, 68, 0.4)";
        cancelBtn.style.color = "#fca5a5";
        cancelBtn.style.borderRadius = "6px";
        cancelBtn.style.cursor = "pointer";
        cancelBtn.style.fontWeight = "bold";
        cancelBtn.style.fontSize = "0.85rem";
        cancelBtn.style.transition = "all 0.2s";
        cancelBtn.textContent = "Cancel";

        cancelBtn.onmouseover = () => {
            cancelBtn.style.background = "rgba(239, 68, 68, 0.35)";
            cancelBtn.style.color = "#ffffff";
        };
        cancelBtn.onmouseout = () => {
            cancelBtn.style.background = "rgba(239, 68, 68, 0.2)";
            cancelBtn.style.color = "#fca5a5";
        };

        cancelBtn.onclick = () => {
            abortController.abort();
            fetch(`${backendUrl}/cancel_prepare`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ job_id: job_id })
            }).catch(e => console.error("Cancel failed:", e));
            overlay.remove();
        };

        content.appendChild(spinner);
        content.appendChild(title);
        content.appendChild(msg);
        content.appendChild(cancelBtn);
        overlay.appendChild(content);
        document.body.appendChild(overlay);
    }

    function initiateTIFFDownload(filename, pixelWindow = null) {
        const payload = { file: filename };

        if (pixelWindow) {
            payload.xoff = pixelWindow.xoff;
            payload.yoff = pixelWindow.yoff;
            payload.width = pixelWindow.width;
            payload.height = pixelWindow.height;
        }

        fetch(`${backendUrl}/prepare_tiff`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        })
            .then(response => {
                if (!response.ok) throw new Error("Failed to initialize preparation.");
                return response.json();
            })
            .then(data => {
                if (data.error) throw new Error(data.error);

                const job_id = data.job_id;
                const abortController = new AbortController();

                showPreparingOverlay(filename, job_id, abortController);
                pollPrepareStatus(job_id, filename, abortController);
            })
            .catch(err => {
                alert("Download Preparation Failed: " + err.message);
            });
    }

    function pollPrepareStatus(job_id, filename, abortController) {
        const interval = setInterval(() => {
            if (abortController.signal.aborted) {
                clearInterval(interval);
                return;
            }

            fetch(`${backendUrl}/prepare_status?job_id=${job_id}`, { signal: abortController.signal })
                .then(res => {
                    if (!res.ok) throw new Error("Status check failed");
                    return res.json();
                })
                .then(data => {
                    if (data.status === "completed") {
                        clearInterval(interval);
                        const overlay = document.getElementById("prepOverlay");
                        if (overlay) overlay.remove();

                        const dlUrl = `${backendUrl}/download_prepared?job_id=${job_id}`;
                        triggerChromeDownload(dlUrl);
                    } else if (data.status === "failed") {
                        clearInterval(interval);
                        const overlay = document.getElementById("prepOverlay");
                        if (overlay) overlay.remove();
                        alert("Preparation failed: " + (data.error || "Unknown error"));
                    } else if (data.status === "cancelled") {
                        clearInterval(interval);
                        const overlay = document.getElementById("prepOverlay");
                        if (overlay) overlay.remove();
                    }
                })
                .catch(err => {
                    if (err.name === "AbortError") return;
                    console.error("Polling error:", err);
                });
        }, 1000);
    }

    function triggerChromeDownload(url) {
        if (chrome.downloads) {
            chrome.downloads.download({
                url: url,
                saveAs: false
            });
        } else {
            const a = document.createElement("a");
            a.href = url;
            a.style.display = "none";
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        }
    }

    if (!dataList || dataList.length === 0) {
        document.body.innerHTML = "<div style='color: white; text-align: center; margin-top: 50px;'><h2>No Geospatial Data Found</h2><p>Please upload a file in the extension popup first.</p></div>";
        document.body.style.backgroundColor = "#0a0e14";
        return;
    }

    // --- Metadata Panel ---
    const metaToggleBtn = document.getElementById("metaToggleBtn");
    const metaPanel = document.getElementById("metaPanel");
    const metaCloseBtn = document.getElementById("metaCloseBtn");
    const metaPanelBody = document.getElementById("metaPanelBody");

    function buildMetaPanel(filename, meta, bounds, center) {
        if (!meta) { metaPanelBody.innerHTML = '<p style="color:#6ee7b7">No metadata available.</p>'; return; }
        let html = '';

        const native = meta.native || {};
        const fileSize = native.width && native.height
            ? ((native.width * native.height * (native.nband || 3)) / (1024 ** 3)).toFixed(2) + ' GB (uncompressed)'
            : 'N/A';

        let compLabel = 'Compression';
        let compDisplay = native.compression_ratio || 'N/A';
        if (filename && filename.toLowerCase().endsWith('.sid')) {
            compLabel = 'MrSID Compression';
            if (compDisplay !== 'N/A') {
                let displayRatio = compDisplay;
                if (compDisplay.includes(".")) {
                    const parts = compDisplay.split(":");
                    if (parts.length === 2) {
                        const num = Math.round(parseFloat(parts[0]));
                        displayRatio = `${num}:${parts[1]}`;
                    }
                }
                compDisplay = displayRatio;
            }
        }

        // General section
        html += '<div class="meta-section">General</div>';
        const general = [
            ['File Name', filename || 'N/A'],
            ['Format', native.format || meta.driverShortName || 'MrSID'],
            ['EPSG', meta.epsg || 'N/A'],
            ['Image Size', meta.size ? meta.size[0].toLocaleString() + ' x ' + meta.size[1].toLocaleString() + ' px' : 'N/A'],
            ['Bands', native.nband || 'N/A'],
            ['Color Space', native.color_space || 'N/A'],
            ['Data Type', native.datatype || 'N/A'],
            ['Nominal Size', native.nominal_size || fileSize],
            ['Physical Size', native.physical_size || 'N/A'],
            [compLabel, compDisplay],
            ['Pyramid Levels', native.num_levels || 'N/A'],
        ];
        for (const [k, v] of general) {
            html += `<div class="meta-row"><span class="meta-row-label">${k}</span><span class="meta-row-value">${v}</span></div>`;
        }

        // Geo section
        html += '<div class="meta-section">Geo Coordinates (Native CRS)</div>';
        const geo = [
            ['X Min', native.xmin != null ? native.xmin.toFixed(6) : 'N/A'],
            ['X Max', native.xmax != null ? native.xmax.toFixed(6) : 'N/A'],
            ['Y Min', native.ymin != null ? native.ymin.toFixed(6) : 'N/A'],
            ['Y Max', native.ymax != null ? native.ymax.toFixed(6) : 'N/A'],
            ['X Resolution', native.x_res != null ? native.x_res + ' m/px' : 'N/A'],
            ['Y Resolution', native.y_res != null ? Math.abs(native.y_res) + ' m/px' : 'N/A'],
        ];
        for (const [k, v] of geo) {
            html += `<div class="meta-row"><span class="meta-row-label">${k}</span><span class="meta-row-value">${v}</span></div>`;
        }

        // WGS84 bounds (from the bounds object passed to map)
        html += '<div class="meta-section">WGS84 Bounds</div>';
        const wgs = [
            ['Min Latitude', bounds.minLat != null ? bounds.minLat.toFixed(8) : 'N/A'],
            ['Max Latitude', bounds.maxLat != null ? bounds.maxLat.toFixed(8) : 'N/A'],
            ['Min Longitude', bounds.minLon != null ? bounds.minLon.toFixed(8) : 'N/A'],
            ['Max Longitude', bounds.maxLon != null ? bounds.maxLon.toFixed(8) : 'N/A'],
        ];
        for (const [k, v] of wgs) {
            html += `<div class="meta-row"><span class="meta-row-label">${k}</span><span class="meta-row-value">${v}</span></div>`;
        }

        // Center
        html += '<div class="meta-section">Center</div>';
        html += `<div class="meta-row"><span class="meta-row-label">Latitude</span><span class="meta-row-value">${center.lat.toFixed(8)}</span></div>`;
        html += `<div class="meta-row"><span class="meta-row-label">Longitude</span><span class="meta-row-value">${center.lon.toFixed(8)}</span></div>`;

        metaPanelBody.innerHTML = html;
    }

    // Initialize meta panel with first file's metadata
    if (dataList.length > 0) {
        buildMetaPanel(dataList[0].filename, dataList[0].fullMetadata, dataList[0].bounds, dataList[0].center);
    }

    metaToggleBtn.addEventListener('click', () => {
        const isHidden = metaPanel.classList.contains('hidden');
        metaPanel.classList.toggle('hidden');
        metaToggleBtn.textContent = isHidden ? 'Hide Metadata' : 'Show Metadata';
    });
    metaCloseBtn.addEventListener('click', () => {
        metaPanel.classList.add('hidden');
        metaToggleBtn.textContent = 'Show Metadata';
    });

    // --- HUD Setup ---
    const hud = document.createElement("div");
    hud.id = "hdIndicator";
    hud.innerHTML = `<span id="hdStatus">STATUS: INITIALIZING...</span><span id="gridStatus" style="margin-left: 15px; color: #fbbf24; font-weight: bold; border-left: 1px solid rgba(255,255,255,0.2); padding-left: 15px;">GRID: CHECKING...</span>`;
    document.body.appendChild(hud);

    let activeTiles = 0;
    let failedTiles = 0;
    // --- High Fidelity Base Layers ---
    const osm = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19,
        attribution: 'Tiles &copy; Esri'
    });

    const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 20,
        attribution: 'Tiles &copy; Esri'
    });

    const labels = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png', {
        pane: 'shadowPane',
        opacity: 0.8
    });

    let globalMinLat = Infinity, globalMaxLat = -Infinity;
    let globalMinLon = Infinity, globalMaxLon = -Infinity;
    dataList.forEach(data => {
        if (data.bounds.minLat < globalMinLat) globalMinLat = data.bounds.minLat;
        if (data.bounds.maxLat > globalMaxLat) globalMaxLat = data.bounds.maxLat;
        if (data.bounds.minLon < globalMinLon) globalMinLon = data.bounds.minLon;
        if (data.bounds.maxLon > globalMaxLon) globalMaxLon = data.bounds.maxLon;
    });

    const globalBounds = [
        [globalMinLat, globalMinLon],
        [globalMaxLat, globalMaxLon]
    ];
    let initialCenter = [(globalMinLat + globalMaxLat) / 2, (globalMinLon + globalMaxLon) / 2];

    // Initialize Map with Satellite as default
    const map = L.map("map", {
        layers: [osm, labels],
        zoomControl: false,
        attributionControl: false,
        maxZoom: 20
    }).setView(initialCenter, 15);

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // Layer Control Setup
    const baseMaps = {
        "Satellite View": satellite,
        "Standard Street": osm
    };

    const overlayMaps = {
        "Street Labels": labels
    };

    L.control.layers(baseMaps, overlayMaps, {
        position: 'topright',
        collapsed: false
    }).addTo(map);

    const allGeorefLayers = [];
    const allPreviewOverlays = [];

    // --- BULLETPROOF TILE LOADER (CSP BYPASS) ---
    const BlobTileLayer = L.TileLayer.extend({
        createTile: function (coords, done) {
            const tile = document.createElement('img');
            const url = this.getTileUrl(coords);

            fetch(url)
                .then(response => {
                    if (!response.ok) throw new Error("Tile fetch failed");
                    return response.blob();
                })
                .then(blob => {
                    const objectUrl = URL.createObjectURL(blob);
                    tile.src = objectUrl;
                    done(null, tile);
                })
                .catch(err => {
                    done(err, tile);
                });

            return tile;
        }
    });

    const layerListContainer = document.getElementById("layerList");

    const renderAndLoadLayer = (data, index) => {
        const { center, bounds, image, filename, fullMetadata } = data;
        let gridCells = null;
        const leafletBounds = [
            [bounds.minLat, bounds.minLon],
            [bounds.maxLat, bounds.maxLon]
        ];

        const georefLayer = new BlobTileLayer(`${backendUrl}/tile/{z}/{x}/{y}?file=${encodeURIComponent(filename)}&size=256&v=${Date.now()}`, {
            bounds: leafletBounds,
            maxZoom: 20,
            maxNativeZoom: 20,
            tileSize: 256,
            className: 'crisp-image',
            crossOrigin: true,
            updateWhenIdle: false,
            keepBuffer: 12,
            zIndex: 1000
        }).addTo(map);

        allGeorefLayers.push(georefLayer);

        const previewUrl = image || `${backendUrl}/preview_image?file=${encodeURIComponent(filename)}&v=${Date.now()}`;
        let previewOverlay = L.imageOverlay(previewUrl, leafletBounds, {
            opacity: 0.8,
            zIndex: 500,
            className: 'crisp-image'
        }).addTo(map);

        allPreviewOverlays.push({ overlay: previewOverlay, index });

        // Add to layer UI
        const layerItem = document.createElement("div");
        layerItem.className = "layer-item";
        layerItem.style.flexWrap = "wrap";

        const nameSpan = document.createElement("span");
        nameSpan.className = "layer-item-name";
        nameSpan.textContent = filename;
        nameSpan.title = "Click to show metadata";
        nameSpan.addEventListener('click', () => {
            buildMetaPanel(filename, fullMetadata, bounds, center);
            if (metaPanel.classList.contains('hidden')) {
                metaPanel.classList.remove('hidden');
                metaToggleBtn.textContent = 'Hide Metadata';
            }
        });

        const zoomBtn = document.createElement("button");
        zoomBtn.className = "zoom-to-btn";
        zoomBtn.textContent = "Zoom";
        zoomBtn.addEventListener("click", () => {
            map.fitBounds(leafletBounds, { animate: true, duration: 1 });
            buildMetaPanel(filename, fullMetadata, bounds, center);
        });

        layerItem.appendChild(nameSpan);

        // Add compression ratio badge if available
        const nativeMeta = fullMetadata?.native || {};
        const compRatio = nativeMeta.compression_ratio;
        if (compRatio && compRatio !== "N/A") {
            const compBadge = document.createElement("span");
            compBadge.className = "compression-badge";
            let displayText = compRatio;
            if (compRatio.includes(".")) {
                const parts = compRatio.split(":");
                if (parts.length === 2) {
                    const num = Math.round(parseFloat(parts[0]));
                    displayText = `${num}:${parts[1]}`;
                }
            }
            compBadge.textContent = displayText;
            compBadge.title = `Compression Ratio: ${compRatio} (${displayText.split(':')[0]}x smaller)`;
            layerItem.appendChild(compBadge);
        }

        layerItem.appendChild(zoomBtn);

        const deleteBtn = document.createElement("button");
        deleteBtn.className = "zoom-to-btn";
        deleteBtn.innerHTML = "&#x2715;"; // ✕ Unicode character
        deleteBtn.title = "Remove layer";
        deleteBtn.style.background = "rgba(239, 68, 68, 0.2)";
        deleteBtn.style.borderColor = "rgba(239, 68, 68, 0.4)";
        deleteBtn.style.color = "#fca5a5";
        deleteBtn.style.marginLeft = "5px";
        deleteBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            if (confirm(`Are you sure you want to remove ${filename}?`)) {
                // Remove layers from map
                map.removeLayer(georefLayer);
                if (previewOverlay) {
                    map.removeLayer(previewOverlay);
                }

                // Clear active grid overlay elements if any
                if (gridCells) {
                    gridCells.forEach(cell => {
                        map.removeLayer(cell.rect);
                        map.removeLayer(cell.labelMarker);
                    });
                }

                // Call cleanup API on backend for this specific file
                fetch(`${backendUrl}/cleanup`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ filename: filename })
                }).catch(err => console.error("Cleanup failed:", err));

                // Remove from DOM
                layerItem.remove();

                // Update chrome.storage.local
                chrome.storage.local.get("mapDataList", (res) => {
                    const currentList = res.mapDataList || [];
                    const updatedList = currentList.filter(item => item.filename !== filename);
                    chrome.storage.local.set({ mapDataList: updatedList });
                });

                // Update local in-memory lists
                const idx = dataList.findIndex(item => item.filename === filename);
                if (idx > -1) {
                    dataList.splice(idx, 1);
                }
            }
        });
        layerItem.appendChild(deleteBtn);

        const isSid = filename && filename.toLowerCase().endsWith(".sid");
        if (isSid) {
            const downloadBtn = document.createElement("button");
            downloadBtn.className = "zoom-to-btn";
            downloadBtn.textContent = "Download";
            downloadBtn.style.marginLeft = "5px";
            downloadBtn.style.background = "rgba(59, 130, 246, 0.2)";
            downloadBtn.style.borderColor = "rgba(59, 130, 246, 0.4)";
            downloadBtn.style.color = "#93c5fd";

            const renderGridWithMetadata = (meta) => {
                const native = meta ? (meta.native || {}) : {};
                const width = native.width || 0;
                const height = native.height || 0;
                const nband = native.nband || 3;
                const uncompressedSize = width * height * nband;

                const LIMIT = 4.5 * 1024 * 1024 * 1024;
                const isLarge = uncompressedSize > LIMIT;

                if (isLarge) {
                    // Tiled export panel
                    const partsDiv = document.createElement("div");
                    partsDiv.style.display = "none";
                    partsDiv.style.marginTop = "8px";
                    partsDiv.style.padding = "8px";
                    partsDiv.style.background = "rgba(255, 255, 255, 0.03)";
                    partsDiv.style.borderRadius = "6px";
                    partsDiv.style.border = "1px solid rgba(255, 255, 255, 0.05)";
                    partsDiv.style.fontSize = "0.7rem";
                    partsDiv.style.width = "100%";

                    const totalParts = Math.ceil(uncompressedSize / LIMIT);
                    const aspect = width / height;
                    let rows = Math.ceil(Math.sqrt(totalParts / aspect));
                    let cols = Math.ceil(totalParts / rows);
                    while (cols * rows < totalParts) { cols++; }

                    partsDiv.innerHTML = `<div style="margin-bottom: 5px; opacity:0.7; font-size:0.65rem;">Select Part (100% Resolution):</div>`;

                    gridCells = [];
                    const lat_span = bounds.maxLat - bounds.minLat;
                    const lon_span = bounds.maxLon - bounds.minLon;
                    const cell_lat_height = lat_span / rows;
                    const cell_lon_width = lon_span / cols;

                    const gridContainer = document.createElement("div");
                    gridContainer.style.display = "grid";
                    gridContainer.style.gap = "4px";
                    gridContainer.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;

                    const downloadPart = (btn, pixelWindow) => {
                        if (btn.disabled) return;

                        btn.disabled = true;
                        btn.style.opacity = "0.6";
                        btn.style.cursor = "not-allowed";

                        setTimeout(() => {
                            btn.disabled = false;
                            btn.style.opacity = "1";
                            btn.style.cursor = "pointer";
                        }, 2000);

                        initiateTIFFDownload(filename, pixelWindow);
                    };

                    // Add "Download All" button
                    const downloadAllBtn = document.createElement("button");
                    downloadAllBtn.className = "zoom-to-btn";
                    downloadAllBtn.textContent = "Download All";
                    downloadAllBtn.style.width = "100%";
                    downloadAllBtn.style.marginBottom = "8px";
                    downloadAllBtn.style.background = "rgba(16, 185, 129, 0.3)";
                    downloadAllBtn.style.borderColor = "rgba(16, 185, 129, 0.5)";
                    downloadAllBtn.style.color = "#a7f3d0";
                    downloadAllBtn.style.fontWeight = "bold";
                    downloadAllBtn.addEventListener("click", (e) => {
                        e.stopPropagation();
                        const btns = Array.from(gridContainer.children);
                        btns.forEach((btn, idx) => {
                            const cell = cellsData[idx];
                            setTimeout(() => {
                                downloadPart(btn, cell.pixel_window);
                            }, idx * 1000);
                        });
                    });
                    partsDiv.appendChild(downloadAllBtn);

                    const cellsData = meta?.grid_cells;
                    console.log("[GRID DEBUG] filename:", filename);
                    console.log("[GRID DEBUG] meta:", meta);
                    console.log("[GRID DEBUG] cellsData:", cellsData);

                    if (cellsData && cellsData.length > 0) {
                        const gridStatusEl = document.getElementById("gridStatus");
                        if (gridStatusEl) {
                            gridStatusEl.textContent = "GRID: ROTATED POLYGONS ACTIVE";
                            gridStatusEl.style.color = "#10b981"; // Green
                        }
                        cellsData.forEach((cell, idx) => {
                            const cellName = cell.name;
                            const polygonCoords = cell.polygon;
                            const centerCoords = cell.center;
                            const r = cell.row;
                            const c = cell.col;

                            const rect = L.polygon(polygonCoords, {
                                color: "#2563eb",
                                weight: 1,
                                lineJoin: "miter",
                                lineCap: "butt",
                                fillColor: "#3b82f6",
                                fillOpacity: 0.02,
                                smoothFactor: 0,
                                interactive: true
                            });

                            rect.bindTooltip(`Part ${idx + 1} (Double-click to download)`, {
                                permanent: false,
                                direction: "center",
                                className: "leaflet-tooltip-custom"
                            });

                            const labelIcon = L.divIcon({
                                className: 'grid-cell-label',
                                html: `<div style="color: #6ee7b7; font-weight: bold; font-size: 11px; text-shadow: 0 0 4px #000; background: rgba(6, 8, 10, 0.5); padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(110, 231, 183, 0.2); text-align: center; white-space: nowrap; pointer-events: none;">${cellName}</div>`,
                                iconSize: [40, 20],
                                iconAnchor: [20, 10]
                            });

                            const labelMarker = L.marker(centerCoords, {
                                icon: labelIcon,
                                interactive: false
                            });

                            gridCells.push({
                                rect: rect,
                                labelMarker: labelMarker,
                                cellName: cellName
                            });

                            rect.on("dblclick", (e) => {
                                L.DomEvent.stopPropagation(e);
                                const btn = gridContainer.children[idx];
                                if (btn) btn.click();
                            });

                            rect.on("mouseover", () => {
                                rect.setStyle({
                                    color: "#10b981",
                                    weight: 1,
                                    fillOpacity: 0.08
                                });
                                const btn = gridContainer.children[idx];
                                if (btn) {
                                    btn.style.borderColor = "#10b981";
                                    btn.style.background = "rgba(16, 185, 129, 0.2)";
                                }
                            });

                            rect.on("mouseout", () => {
                                const btn = gridContainer.children[idx];
                                if (btn && !btn.disabled && btn.textContent === cellName) {
                                    rect.setStyle({
                                        color: "rgba(59, 130, 246, 0.4)",
                                        weight: 1.5,
                                        fillOpacity: 0.05
                                    });
                                    btn.style.borderColor = "";
                                    btn.style.background = "";
                                }
                            });

                            const partBtn = document.createElement("button");
                            partBtn.className = "zoom-to-btn";
                            partBtn.textContent = cellName;
                            partBtn.style.padding = "2px 4px";
                            partBtn.style.fontSize = "0.65rem";
                            partBtn.style.fontWeight = "bold";

                            partBtn.addEventListener("mouseover", () => {
                                if (!partBtn.disabled && partBtn.textContent === cellName) {
                                    rect.setStyle({
                                        color: "#10b981",
                                        weight: 2.2,
                                        fillOpacity: 0.18
                                    });
                                }
                            });

                            partBtn.addEventListener("mouseout", () => {
                                if (!partBtn.disabled && partBtn.textContent === cellName) {
                                    rect.setStyle({
                                        color: "rgba(59, 130, 246, 0.4)",
                                        weight: 1.5,
                                        fillOpacity: 0.05
                                    });
                                }
                            });

                            partBtn.addEventListener("click", (e) => {
                                e.stopPropagation();
                                downloadPart(partBtn, cell.pixel_window);
                            });

                            gridContainer.appendChild(partBtn);
                        });
                    } else {
                        console.log("[GRID DEBUG] cellsData missing or empty, using straight fallback grid!");
                        const gridStatusEl = document.getElementById("gridStatus");
                        if (gridStatusEl) {
                            gridStatusEl.textContent = "GRID: FALLBACK RECTANGLES ACTIVE";
                            gridStatusEl.style.color = "#ef4444"; // Red
                        }
                        for (let r = 0; r < rows; r++) {
                            for (let c = 0; c < cols; c++) {
                                const idx = r * cols + c;
                                const cellName = `P${idx + 1}`;

                                const cell_minLat = bounds.maxLat - (r + 1) * cell_lat_height;
                                const cell_maxLat = bounds.maxLat - r * cell_lat_height;
                                const cell_minLon = bounds.minLon + c * cell_lon_width;
                                const cell_maxLon = bounds.minLon + (c + 1) * cell_lon_width;

                                const cellBounds = [
                                    [cell_minLat, cell_minLon],
                                    [cell_maxLat, cell_maxLon]
                                ];

                                const rect = L.rectangle(cellBounds, {
                                    color: "rgba(59, 130, 246, 0.4)",
                                    weight: 1.5,
                                    fillColor: "#3b82f6",
                                    fillOpacity: 0.05,
                                    interactive: true
                                });

                                rect.bindTooltip(`Part ${idx + 1} (Double-click to download)`, {
                                    permanent: false,
                                    direction: "center",
                                    className: "leaflet-tooltip-custom"
                                });

                                const centerLat = (cell_minLat + cell_maxLat) / 2;
                                const centerLon = (cell_minLon + cell_maxLon) / 2;
                                const labelIcon = L.divIcon({
                                    className: 'grid-cell-label',
                                    html: `<div style="color: #6ee7b7; font-weight: bold; font-size: 11px; text-shadow: 0 0 4px #000; background: rgba(6, 8, 10, 0.5); padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(110, 231, 183, 0.2); text-align: center; white-space: nowrap; pointer-events: none;">${cellName}</div>`,
                                    iconSize: [40, 20],
                                    iconAnchor: [20, 10]
                                });

                                const labelMarker = L.marker([centerLat, centerLon], {
                                    icon: labelIcon,
                                    interactive: false
                                });

                                gridCells.push({
                                    rect: rect,
                                    labelMarker: labelMarker,
                                    cellName: cellName
                                });

                                rect.on("dblclick", (e) => {
                                    L.DomEvent.stopPropagation(e);
                                    const btn = gridContainer.children[idx];
                                    if (btn) btn.click();
                                });

                                rect.on("mouseover", () => {
                                    rect.setStyle({
                                        color: "#10b981",
                                        weight: 2,
                                        fillOpacity: 0.15
                                    });
                                    const btn = gridContainer.children[idx];
                                    if (btn) {
                                        btn.style.borderColor = "#10b981";
                                        btn.style.background = "rgba(16, 185, 129, 0.2)";
                                    }
                                });

                                rect.on("mouseout", () => {
                                    const btn = gridContainer.children[idx];
                                    if (btn && !btn.disabled && btn.textContent === cellName) {
                                        rect.setStyle({
                                            color: "rgba(59, 130, 246, 0.4)",
                                            weight: 1.5,
                                            fillOpacity: 0.05
                                        });
                                        btn.style.borderColor = "";
                                        btn.style.background = "";
                                    }
                                });

                                const partBtn = document.createElement("button");
                                partBtn.className = "zoom-to-btn";
                                partBtn.textContent = cellName;
                                partBtn.style.padding = "2px 4px";
                                partBtn.style.fontSize = "0.65rem";
                                partBtn.style.fontWeight = "bold";

                                partBtn.addEventListener("mouseover", () => {
                                    if (!partBtn.disabled && partBtn.textContent === cellName) {
                                        rect.setStyle({
                                            color: "#10b981",
                                            weight: 2.2,
                                            fillOpacity: 0.18
                                        });
                                    }
                                });

                                partBtn.addEventListener("mouseout", () => {
                                    if (!partBtn.disabled && partBtn.textContent === cellName) {
                                        rect.setStyle({
                                            color: "rgba(59, 130, 246, 0.4)",
                                            weight: 1.5,
                                            fillOpacity: 0.05
                                        });
                                    }
                                });

                                partBtn.addEventListener("click", (e) => {
                                    e.stopPropagation();
                                    const xoff = Math.floor(c * width / cols);
                                    const yoff = Math.floor(r * height / rows);
                                    downloadPart(partBtn, {
                                        xoff,
                                        yoff,
                                        width: Math.floor((c + 1) * width / cols) - xoff,
                                        height: Math.floor((r + 1) * height / rows) - yoff
                                    });
                                });

                                gridContainer.appendChild(partBtn);
                            }
                        }
                    }
                    partsDiv.appendChild(gridContainer);

                    downloadBtn.addEventListener("click", (e) => {
                        e.stopPropagation();
                        const show = partsDiv.style.display === "none";
                        partsDiv.style.display = show ? "block" : "none";
                        if (show) {
                            gridCells.forEach(cell => {
                                cell.rect.addTo(map);
                                cell.labelMarker.addTo(map);
                            });
                        } else {
                            gridCells.forEach(cell => {
                                map.removeLayer(cell.rect);
                                map.removeLayer(cell.labelMarker);
                            });
                        }
                    });

                    layerItem.appendChild(downloadBtn);
                    // Wrap partsDiv in a container that spans full width under the layer item
                    const wrapper = document.createElement("div");
                    wrapper.style.width = "100%";
                    wrapper.appendChild(partsDiv);
                    layerItem.appendChild(wrapper);
                } else {
                    // Small file: Single full TIFF download button
                    const downloadTiffBtn = document.createElement("button");
                    downloadTiffBtn.className = "zoom-to-btn";
                    downloadTiffBtn.textContent = "Download TIFF";
                    downloadTiffBtn.style.width = "100%";
                    downloadTiffBtn.style.marginTop = "8px";
                    downloadTiffBtn.style.background = "rgba(16, 185, 129, 0.15)";
                    downloadTiffBtn.style.borderColor = "rgba(16, 185, 129, 0.3)";
                    downloadTiffBtn.style.color = "#a7f3d0";
                    downloadTiffBtn.style.fontWeight = "bold";
                    downloadTiffBtn.addEventListener("click", (e) => {
                        e.stopPropagation();
                        initiateTIFFDownload(filename);
                    });
                    layerItem.appendChild(downloadTiffBtn);
                }
            };

            // Self-healing metadata fetch
            if (!fullMetadata || !fullMetadata.grid_cells) {
                console.log("[GRID DEBUG] fullMetadata or grid_cells missing from storage. Fetching dynamically from server for:", filename);
                fetch(`${backendUrl}/metadata`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ filename: filename })
                })
                    .then(res => res.json())
                    .then(freshMeta => {
                        let metaObj = freshMeta;
                        if (freshMeta && freshMeta.metadata_json) {
                            metaObj = freshMeta.metadata_json;
                        }
                        console.log("[GRID DEBUG] Fetched fresh metadata successfully:", metaObj);

                        // Update storage
                        chrome.storage.local.get("mapDataList", (res) => {
                            const list = res.mapDataList || [];
                            const item = list.find(x => x.filename === filename);
                            if (item) {
                                item.fullMetadata = metaObj;
                                chrome.storage.local.set({ mapDataList: list });
                            }
                        });

                        renderGridWithMetadata(metaObj);
                    })
                    .catch(err => {
                        console.error("[GRID DEBUG] Failed to fetch fresh metadata from server, falling back to local storage version:", err);
                        renderGridWithMetadata(fullMetadata);
                    });
            } else {
                renderGridWithMetadata(fullMetadata);
            }
        }

        layerListContainer.appendChild(layerItem);

        // --- Diagnostic Listeners ---
        georefLayer.on('loading', () => {
            document.getElementById("hdStatus").textContent = "STATUS: LOADING HD...";
            document.getElementById("hdStatus").style.color = "var(--accent-blue)";
        });

        georefLayer.on('tileload', () => {
            activeTiles++;
            const po = allPreviewOverlays.find(p => p.index === index);
            if (activeTiles > 2 && po && po.overlay) {
                map.removeLayer(po.overlay);
                po.overlay = null;
                document.getElementById("hdStatus").textContent = "STATUS: HD ACTIVE";
                document.getElementById("hdStatus").style.color = "var(--success)";
            }
        });

        georefLayer.on('tileerror', async (e) => {
            failedTiles++;
            console.error("Tile Fail:", e);
        });
    };

    dataList.forEach((data, index) => {
        renderAndLoadLayer(data, index);
    });

    // Fit Initial View precisely to global bounds
    map.fitBounds(globalBounds, { padding: [20, 20], animate: false });

    // --- Interactivity ---
    map.on('zoomend', () => {
        document.getElementById("zoomLevel").textContent = map.getZoom();
    });

    const opacityInput = document.getElementById("opacityRange");
    opacityInput.addEventListener('input', (e) => {
        const val = e.target.value / 100;
        allGeorefLayers.forEach(layer => layer.setOpacity(val));
        allPreviewOverlays.forEach(po => {
            if (po.overlay) po.overlay.setOpacity(val);
        });
    });

    // Premium Touch: Attribution
    L.control.attribution({ position: 'bottomleft' })
        .addAttribution("© Premium Geoviewer | Metadata Driven Engine")
        .addTo(map);

    window.addEventListener("beforeunload", () => {
        dataList.forEach(data => {
            const fname = data.filename;
            const url = `${backendUrl}/cleanup`;
            const payload = JSON.stringify({ filename: fname });
            if (navigator.sendBeacon) {
                const blob = new Blob([payload], { type: "application/json" });
                navigator.sendBeacon(url, blob);
            } else {
                fetch(url, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: payload,
                    keepalive: true
                });
            }
        });
    });

    // ------------------------------------------------------------------
    // UPDATED: Direct Upload from Map – now using the TURBO parallel engine
    // (exactly as in the 372‑line popup.js)
    // ------------------------------------------------------------------
    const mapUploadBtn = document.getElementById("mapUploadBtn");
    const mapFileInput = document.getElementById("mapFileInput");
    const uploadStatusContainer = document.getElementById("uploadStatusContainer");
    const uploadStatusText = document.getElementById("uploadStatusText");
    const uploadProgressBar = document.getElementById("uploadProgressBar");

    if (mapUploadBtn && mapFileInput) {
        mapUploadBtn.addEventListener("click", () => {
            mapFileInput.click();
        });

        mapFileInput.addEventListener("change", async () => {
            if (mapFileInput.files.length === 0) return;
            const files = mapFileInput.files;
            const MAX_TOTAL_UPLOAD_SIZE = 20 * 1024 * 1024 * 1024;
            const totalSize = Array.from(files).reduce((sum, file) => sum + file.size, 0);
            if (totalSize > MAX_TOTAL_UPLOAD_SIZE) {
                alert("You can enter only 20 GB of files.");
                mapFileInput.value = "";
                return;
            }

            mapUploadBtn.disabled = true;
            mapUploadBtn.textContent = "Processing...";
            mapUploadBtn.style.opacity = "0.7";
            uploadStatusContainer.style.display = "block";

            const largeOverlay = document.getElementById("largeUploadOverlay");
            const largeText = document.getElementById("largeUploadStatusText");
            const largeBar = document.getElementById("largeUploadProgressBar");

            if (largeOverlay) {
                largeOverlay.style.display = "flex";
            }

            let hasError = false;
            let lastData = null;

            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const fileIndexStr = ` (${i + 1}/${files.length})`;

                uploadStatusText.textContent = `Checking Local Cache${fileIndexStr}...`;
                uploadProgressBar.style.width = "0%";
                uploadProgressBar.style.background = "";
                if (largeText) largeText.textContent = `Checking Local Cache${fileIndexStr}...`;
                if (largeBar) {
                    largeBar.style.width = "0%";
                    largeBar.style.background = "#3b82f6";
                }

                try {
                    // Check if file exists locally on server
                    let findRes = await fetch(`${backendUrl}/find_local`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ filename: file.name })
                    });
                    let findData = await findRes.json();

                    let data;
                    if (findData.found) {
                        uploadStatusText.textContent = `Found locally! Loading${fileIndexStr}...`;
                        uploadProgressBar.style.width = "50%";
                        if (largeText) largeText.textContent = `Found locally! Loading${fileIndexStr}...`;
                        if (largeBar) largeBar.style.width = "50%";
                        let openRes = await fetch(`${backendUrl}/open_local`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ path: findData.path })
                        });
                        data = await openRes.json();
                    } else {
                        // --- TURBO PARALLEL UPLOAD (NEW) ---
                        data = await turboParallelUpload(file);
                    }

                    if (data.error) throw new Error(data.error);

                    uploadStatusText.textContent = `Fetching Preview${fileIndexStr}...`;
                    uploadProgressBar.style.width = "90%";
                    if (largeText) largeText.textContent = `Fetching Preview${fileIndexStr}...`;
                    if (largeBar) largeBar.style.width = "90%";

                    // Get preview image
                    const previewUrl = `${backendUrl}/preview_image?file=${encodeURIComponent(data.name)}&v=${Date.now()}`;
                    const previewRes = await fetch(previewUrl);
                    const blob = await previewRes.blob();
                    const objectUrl = URL.createObjectURL(blob);

                    // Add to dataList and save to chrome.storage.local
                    const newLayerData = {
                        center: data.center,
                        bounds: data.bounds,
                        filename: data.name,
                        fullMetadata: data.full_metadata,
                        image: objectUrl
                    };

                    await new Promise((resolve) => {
                        chrome.storage.local.get("mapDataList", (res) => {
                            const currentList = res.mapDataList || [];
                            currentList.push({
                                center: data.center,
                                bounds: data.bounds,
                                filename: data.name,
                                fullMetadata: data.full_metadata,
                                image: ""
                            });
                            chrome.storage.local.set({ mapDataList: currentList }, () => {
                                dataList.push(newLayerData);
                                resolve();
                            });
                        });
                    });

                    // Add to Leaflet map dynamically
                    const newIndex = allGeorefLayers.length;
                    renderAndLoadLayer(newLayerData, newIndex);
                    lastData = data;

                } catch (err) {
                    console.error("Direct Upload Failed:", err);
                    hasError = true;
                    uploadStatusText.textContent = `Failed: ${file.name}`;
                    uploadProgressBar.style.background = "#ef4444";
                    if (largeText) largeText.textContent = `Failed: ${file.name}`;
                    if (largeBar) {
                        largeBar.style.width = "100%";
                        largeBar.style.background = "#ef4444";
                    }
                    await new Promise(resolve => setTimeout(resolve, 3000));
                }
            }

            if (!hasError && lastData) {
                const leafletBounds = [
                    [lastData.bounds.minLat, lastData.bounds.minLon],
                    [lastData.bounds.maxLat, lastData.bounds.maxLon]
                ];
                map.fitBounds(leafletBounds, { padding: [20, 20], animate: true, duration: 1.5 });

                uploadStatusText.textContent = "All files successfully uploaded!";
                uploadProgressBar.style.width = "100%";
                if (largeText) largeText.textContent = "All files successfully uploaded!";
                if (largeBar) {
                    largeBar.style.width = "100%";
                    largeBar.style.background = "#10b981";
                }
            }

            setTimeout(() => {
                uploadStatusContainer.style.display = "none";
                if (largeOverlay) largeOverlay.style.display = "none";
                uploadProgressBar.style.background = "";
                mapUploadBtn.disabled = false;
                mapUploadBtn.textContent = "Upload Image";
                mapUploadBtn.style.opacity = "";
            }, 3000);

            mapFileInput.value = "";
        });
    }

    // ------------------------------------------------------------------
    // TURBO PARALLEL UPLOAD ENGINE (ported from 372‑line popup.js)
    // Uses 2 MB chunks, 10 concurrent streams, and automatic retry.
    // ------------------------------------------------------------------
    async function turboParallelUpload(file) {
        const CHUNK_SIZE = 2 * 1024 * 1024; // 2MB per chunk for max parallelism
        const MAX_CONCURRENT = 10;          // 10 parallel uploads

        const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
        uploadStatusText.textContent = ` Uploading ${totalChunks} chunks in parallel...`;
        const largeText = document.getElementById("largeUploadStatusText");
        const largeBar = document.getElementById("largeUploadProgressBar");
        if (largeText) largeText.textContent = ` Uploading ${totalChunks} chunks in parallel...`;

        // 1. Initialize upload (create empty file)
        const initRes = await fetch(`${backendUrl}/init_upload_fast`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ filename: file.name, size: file.size })
        });
        const initData = await initRes.json();
        if (initData.error) throw new Error(initData.error);

        // 2. Prepare all chunk tasks
        const uploadTasks = [];
        for (let i = 0; i < totalChunks; i++) {
            const start = i * CHUNK_SIZE;
            const end = Math.min(start + CHUNK_SIZE, file.size);
            const chunk = file.slice(start, end);

            const formData = new FormData();
            formData.append("chunk", chunk);
            formData.append("filename", file.name);
            formData.append("offset", start.toString());
            formData.append("chunk_index", i.toString());

            uploadTasks.push({
                index: i,
                formData: formData,
                start: start
            });
        }

        // 3. Upload in parallel batches
        let uploaded = 0;
        const results = [];

        for (let i = 0; i < uploadTasks.length; i += MAX_CONCURRENT) {
            const batch = uploadTasks.slice(i, i + MAX_CONCURRENT);

            const batchPromises = batch.map(task =>
                fetch(`${backendUrl}/upload_chunk_fast`, {
                    method: "POST",
                    body: task.formData
                })
                    .then(res => {
                        if (!res.ok) throw new Error(`Chunk ${task.index} failed`);
                        return task.index;
                    })
                    .catch(err => {
                        console.error(`Chunk ${task.index} failed:`, err);
                        // Retry failed chunk immediately
                        return retryChunk(task);
                    })
            );

            const batchResults = await Promise.all(batchPromises);
            results.push(...batchResults);

            uploaded += batch.length;
            const progress = Math.min(100, Math.round((uploaded / totalChunks) * 100));
            uploadProgressBar.style.width = `${progress}%`;
            if (largeBar) largeBar.style.width = `${progress}%`;
            const statusMsg = ` Uploading: ${progress}% (${uploaded}/${totalChunks})`;
            uploadStatusText.textContent = statusMsg;
            if (largeText) largeText.textContent = statusMsg;
        }

        // 4. Complete upload and process metadata
        uploadStatusText.textContent = "🔍 Processing metadata...";
        if (largeText) largeText.textContent = "🔍 Processing metadata...";
        uploadProgressBar.style.width = "100%";
        if (largeBar) largeBar.style.width = "100%";

        const compRes = await fetch(`${backendUrl}/complete_upload_fast`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ filename: file.name })
        });

        if (!compRes.ok) {
            const errorData = await compRes.json();
            throw new Error(errorData.error || "Completion failed");
        }

        return await compRes.json();
    }

    // Retry failed chunk with exponential backoff
    async function retryChunk(task, retries = 3) {
        for (let attempt = 0; attempt < retries; attempt++) {
            try {
                await new Promise(resolve => setTimeout(resolve, 100 * Math.pow(2, attempt)));
                const res = await fetch(`${backendUrl}/upload_chunk_fast`, {
                    method: "POST",
                    body: task.formData
                });
                if (res.ok) return task.index;
            } catch (err) {
                console.log(`Retry ${attempt + 1} for chunk ${task.index}`);
            }
        }
        throw new Error(`Chunk ${task.index} failed after ${retries} retries`);
    }

    // ------------------------------------------------------------------
    // End of updated upload logic
    // ------------------------------------------------------------------
}
init();
