document.addEventListener("DOMContentLoaded", async () => {
    const dropArea = document.getElementById("dropArea");
    const fileInput = document.getElementById("fileInput");
    const img = document.getElementById("previewImage");
    const dropText = document.getElementById("dropText");
    const loader = document.getElementById("loader");
    const timerEl = document.getElementById("timer");
    const metadataGrid = document.getElementById("metadataGrid");
    const statusValue = document.getElementById("statusValue");
    const statusDot = document.getElementById("statusDot");

    // ✅ NEW: Progress bar elements (ported from the 372-line version)
    // NOTE: Make sure your popup.html has these two elements:
    //   <progress id="progressBar" value="0" max="100" style="display:none;"></progress>
    //   <span id="progressText"></span>
    const progressBar = document.getElementById("progressBar");
    const progressText = document.getElementById("progressText");

    // ⚙️ Settings DOM Elements
    const settingsToggleBtn = document.getElementById("settingsToggleBtn");
    const settingsDrawer = document.getElementById("settingsDrawer");
    const closeSettingsBtn = document.getElementById("closeSettingsBtn");
    const backendUrlInput = document.getElementById("backendUrlInput");
    const saveSettingsBtn = document.getElementById("saveSettingsBtn");
    const downloadTiffBtn = document.getElementById("downloadTiff");
    const partDownloadContainer = document.getElementById("partDownloadContainer");
    const partGrid = document.getElementById("partGrid");

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
                    backendUrl = match[1].trim().replace(/\/$/, "");
                }
            }
        }
    } catch (e) {
        console.error("Could not load backend URL configuration:", e);
    }

    backendUrlInput.value = backendUrl;
    backendUrlInput.readOnly = false;

    saveSettingsBtn.addEventListener("click", () => {
        const newUrl = backendUrlInput.value.trim().replace(/\/$/, "");
        if (newUrl) {
            chrome.storage.local.set({ backendUrl: newUrl }, () => {
                alert("Settings saved successfully!");
                location.reload();
            });
        }
    });

    // Toggle Settings drawer
    settingsToggleBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const show = settingsDrawer.style.display === "none";
        settingsDrawer.style.display = show ? "block" : "none";
    });

    // Open in New Tab
    const openTabBtn = document.getElementById("openTabBtn");
    if (openTabBtn) {
        if (window.innerWidth > 600) {
            openTabBtn.style.display = "none";
        } else {
            openTabBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                chrome.tabs.create({ url: chrome.runtime.getURL("popup.html") });
            });
        }
    }

    closeSettingsBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        settingsDrawer.style.display = "none";
    });

    let mapDataList = [];
    let startTime;
    let timerInterval;
    let mapOpened = false;

    // ✅ ZOOM STATE
    let zoomLevel = 2.5; // 250% default

    // --- Event Listeners ---
    dropArea.addEventListener("click", () => fileInput.click());

    fileInput.addEventListener("change", () => {
        if (fileInput.files.length > 0) processFiles(fileInput.files);
    });

    ["dragenter", "dragover", "dragleave", "drop"].forEach(eventName => {
        dropArea.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) { e.preventDefault(); e.stopPropagation(); }

    ["dragenter", "dragover"].forEach(eventName => {
        dropArea.addEventListener(eventName, () => dropArea.classList.add('dragging'), false);
    });

    ["dragleave", "drop"].forEach(eventName => {
        dropArea.addEventListener(eventName, () => dropArea.classList.remove('dragging'), false);
    });

    dropArea.addEventListener("drop", (e) => {
        if (e.dataTransfer.files.length > 0) processFiles(e.dataTransfer.files);
    });

    async function processFiles(files) {
        const MAX_TOTAL_UPLOAD_SIZE = 20 * 1024 * 1024 * 1024;
        const totalSize = Array.from(files).reduce((sum, file) => sum + file.size, 0);
        if (totalSize > MAX_TOTAL_UPLOAD_SIZE) {
            alert("You can enter only 20 GB of files.");
            fileInput.value = "";
            return;
        }

        let hasError = false;
        for (let i = 0; i < files.length; i++) {
            statusValue.textContent = `Processing file ${i + 1} of ${files.length}...`;
            const success = await uploadFile(files[i], i + 1, files.length);
            if (!success) {
                hasError = true;
            }
        }
        if (!hasError) {
            statusValue.textContent = "All files processed!";
        }
    }

    // --- Upload Logic (TURBO PARALLEL CHUNKS) ---
    async function uploadFile(file, currentIndex = 1, totalFiles = 1) {
        if (!/\.(sid|tif|tiff)$/i.test(file.name)) {
            statusValue.textContent = "Only .sid, .tif, and .tiff files are supported.";
            statusDot.style.background = "var(--danger)";
            return false;
        }

        loader.style.display = "block";
        dropText.style.display = "none";
        img.style.display = "none";
        statusValue.textContent = "Checking Local Cache...";
        statusDot.style.background = "var(--accent-blue)";

        // ✅ NEW: Reset progress bar for each file
        if (progressBar) {
            progressBar.style.display = "block";
            progressBar.value = 0;
        }
        if (progressText) {
            progressText.textContent = "0%";
        }

        startTime = Date.now();
        timerEl.style.display = "block";

        timerInterval = setInterval(() => {
            let seconds = ((Date.now() - startTime) / 1000).toFixed(1);
            timerEl.textContent = String.fromCharCode(177) + " " + seconds + "s";
        }, 100);

        try {
            // FAST PATH: Check if file exists locally on server
            let findRes = await fetch(`${backendUrl}/find_local`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ filename: file.name })
            });
            let findData = await findRes.json();

            let data;
            if (findData.found) {
                statusValue.textContent = "Found locally! Loading...";
                let openRes = await fetch(`${backendUrl}/open_local`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ path: findData.path })
                });
                data = await openRes.json();

                // ✅ NEW: Local cache hit still completes the progress bar
                if (progressBar) progressBar.value = 100;
                if (progressText) progressText.textContent = "100%";
            } else {
                // SLOW PATH: HIGH-SPEED PARALLEL UPLOAD
                data = await performParallelUpload(file);
            }

            if (data.error) throw new Error(data.error);

            clearInterval(timerInterval);
            let totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
            timerEl.textContent = String.fromCharCode(177) + ` PROCESSED: ${totalTime}S`;
            statusValue.textContent = "Analysis Complete";
            statusDot.style.background = "var(--success)";

            loader.style.display = "none";
            // ✅ NEW: Hide progress bar once processing is done
            if (progressBar) progressBar.style.display = "none";

            mapDataList.push({
                center: data.center,
                bounds: data.bounds,
                filename: data.name,
                fullMetadata: data.full_metadata,
                image: ""
            });
            const dataIndex = mapDataList.length - 1;

            renderMetadata(data);

            if (downloadTiffBtn) {
                const isSid = data.name && data.name.toLowerCase().endsWith(".sid");
                if (isSid) {
                    downloadTiffBtn.style.display = "flex";

                    const meta = data.full_metadata || {};
                    const native = meta.native || {};
                    const width = native.width || 0;
                    const height = native.height || 0;
                    const nband = native.nband || 3;
                    const uncompressedSize = width * height * nband;

                    // Large file: threshold at 4.5 GB uncompressed size
                    const LIMIT = 4.5 * 1024 * 1024 * 1024;
                    const isLarge = uncompressedSize > LIMIT;

                    if (isLarge) {
                        downloadTiffBtn.querySelector("span").textContent = "DOWNLOAD TIFF (IN PARTS)";

                        // Calculate grid aspect-ratio aware layout
                        const totalParts = Math.ceil(uncompressedSize / LIMIT);
                        const aspect = width / height;
                        let rows = Math.ceil(Math.sqrt(totalParts / aspect));
                        let cols = Math.ceil(totalParts / rows);
                        while (cols * rows < totalParts) { cols++; }

                        // Build part download grid
                        partDownloadContainer.querySelectorAll(".btn-primary").forEach(el => el.remove());
                        partGrid.innerHTML = "";
                        partGrid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;

                        // Add "Download All Parts" button
                        const downloadAllBtn = document.createElement("button");
                        downloadAllBtn.className = "btn btn-primary";
                        downloadAllBtn.style.background = "var(--success)";
                        downloadAllBtn.style.color = "#05070a";
                        downloadAllBtn.style.marginBottom = "10px";
                        downloadAllBtn.style.width = "100%";
                        downloadAllBtn.innerHTML = "<span>DOWNLOAD ALL PARTS</span><i>&#x2913;</i>";
                        const downloadPart = (btn, r, c, totalRows, totalCols) => {
                            if (btn.disabled) return;

                            const origText = btn.textContent;
                            btn.disabled = true;
                            btn.textContent = `${origText} ⏳`;
                            btn.style.opacity = "0.7";
                            btn.style.cursor = "not-allowed";

                            const url = `${backendUrl}/download_tiff?file=${encodeURIComponent(data.name)}&col=${c}&row=${r}&total_cols=${totalCols}&total_rows=${totalRows}`;
                            const downloadName = `${data.name.split('.').slice(0, -1).join('.')}_part_${r + 1}_${c + 1}.tif`;

                            if (chrome.downloads) {
                                chrome.downloads.download({
                                    url: url,
                                    filename: downloadName,
                                    saveAs: false
                                }, (downloadId) => {
                                    if (chrome.runtime.lastError) {
                                        console.error(chrome.runtime.lastError);
                                        resetBtnFailed();
                                        return;
                                    }

                                    const statusListener = (delta) => {
                                        if (delta.id === downloadId) {
                                            if (delta.state) {
                                                if (delta.state.current === "complete") {
                                                    chrome.downloads.onChanged.removeListener(statusListener);
                                                    setBtnSuccess();
                                                } else if (delta.state.current === "interrupted") {
                                                    chrome.downloads.onChanged.removeListener(statusListener);
                                                    resetBtnFailed();
                                                }
                                            }
                                        }
                                    };
                                    chrome.downloads.onChanged.addListener(statusListener);
                                });
                            } else {
                                // Fallback to window.open if chrome.downloads is not available yet
                                window.open(url);
                                // Fake visual transitions
                                setTimeout(setBtnSuccess, 6000);
                            }

                            function setBtnSuccess() {
                                btn.textContent = `${origText} ✓`;
                                btn.style.background = "#10b981"; // Green
                                btn.style.color = "#05070a";
                                setTimeout(resetBtnNormal, 4000);
                            }

                            function resetBtnFailed() {
                                btn.textContent = `${origText} ❌`;
                                btn.style.background = "#ef4444"; // Red
                                btn.style.color = "#ffffff";
                                setTimeout(resetBtnNormal, 4000);
                            }

                            function resetBtnNormal() {
                                btn.disabled = false;
                                btn.style.opacity = "1";
                                btn.style.cursor = "pointer";
                                btn.textContent = origText;
                                btn.style.background = "";
                                btn.style.color = "";
                            }
                        };

                        downloadAllBtn.onclick = (e) => {
                            e.stopPropagation();
                            const btns = Array.from(partGrid.children);
                            btns.forEach((btn, idx) => {
                                const r = Math.floor(idx / cols);
                                const c = idx % cols;
                                setTimeout(() => {
                                    downloadPart(btn, r, c, rows, cols);
                                }, idx * 1000);
                            });
                        };
                        partDownloadContainer.insertBefore(downloadAllBtn, partGrid);

                        for (let r = 0; r < rows; r++) {
                            for (let c = 0; c < cols; c++) {
                                const partBtn = document.createElement("button");
                                partBtn.className = "zoom-to-btn";
                                partBtn.style.padding = "6px 8px";
                                partBtn.style.fontSize = "0.7rem";
                                partBtn.style.fontWeight = "bold";
                                partBtn.textContent = `Part ${r * cols + c + 1}`;
                                partBtn.onclick = (e) => {
                                    e.stopPropagation();
                                    downloadPart(partBtn, r, c, rows, cols);
                                };
                                partGrid.appendChild(partBtn);
                            }
                        }

                        downloadTiffBtn.onclick = (e) => {
                            e.stopPropagation();
                            const show = partDownloadContainer.style.display === "none";
                            partDownloadContainer.style.display = show ? "block" : "none";
                        };
                    } else {
                        downloadTiffBtn.querySelector("span").textContent = "DOWNLOAD TIFF";
                        partDownloadContainer.style.display = "none";
                        downloadTiffBtn.onclick = (e) => {
                            e.stopPropagation();
                            window.open(`${backendUrl}/download_tiff?file=${encodeURIComponent(data.name)}`);
                        };
                    }
                } else {
                    downloadTiffBtn.style.display = "none";
                    partDownloadContainer.style.display = "none";
                }
            }

            const previewUrl = `${backendUrl}/preview_image?file=${encodeURIComponent(data.name)}&v=${Date.now()}`;

            await fetch(previewUrl)
                .then(response => response.blob())
                .then(blob => {
                    const objectUrl = URL.createObjectURL(blob);
                    mapDataList[dataIndex].image = objectUrl;
                    img.src = objectUrl;
                    img.style.display = "block";
                    zoomLevel = 2.5;
                    img.style.transform = `scale(${zoomLevel})`;
                })
                .catch(err => console.error("Failed preview:", err));

            return true;
        } catch (err) {
            clearInterval(timerInterval);
            timerEl.innerHTML = `<span style="color:var(--danger)">ERROR</span>`;
            loader.style.display = "none";
            dropText.style.display = "block";
            statusValue.textContent = err.message || "Failed";
            statusDot.style.background = "var(--danger)";
            // ✅ NEW: Hide progress bar on error too
            if (progressBar) progressBar.style.display = "none";
            return false;
        }
    }

    async function performParallelUpload(file) {
        const CHUNK_SIZE = 20 * 1024 * 1024; // 20MB per chunk for reliability
        const CONCURRENCY_PER_ORIGIN = 6;     // Browser limit per host

        let HOSTS = [backendUrl];
        if (backendUrl.includes("127.0.0.1")) {
            HOSTS.push(backendUrl.replace("127.0.0.1", "localhost"));
        } else if (backendUrl.includes("localhost")) {
            HOSTS.push(backendUrl.replace("localhost", "127.0.0.1"));
        }

        const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

        statusValue.textContent = `Vortex Engine: Initializing...`;

        // 1. Initialize Upload (Pre-allocation)
        const initRes = await fetch(`${HOSTS[0]}/init_upload`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ filename: file.name, size: file.size })
        });
        const initData = await initRes.json();
        if (initData.error) throw new Error(initData.error);

        // 2. Upload Chunks in Parallel across multiple origins
        let uploadedChunks = 0;
        const uploadChunkTask = async (index) => {
            const start = index * CHUNK_SIZE;
            const end = Math.min(start + CHUNK_SIZE, file.size);
            const chunk = file.slice(start, end);

            const buildFormData = () => {
                const fd = new FormData();
                fd.append("chunk", chunk);
                fd.append("filename", file.name);
                fd.append("offset", start.toString());
                return fd;
            };

            // Round-robin between 127.0.0.1 and localhost to hit 12 concurrent streams
            const host = HOSTS[index % HOSTS.length];

            // ✅ NEW: Automatic retry with exponential backoff (ported from the 372-line version)
            try {
                const res = await fetch(`${host}/upload_chunk`, {
                    method: "POST",
                    body: buildFormData()
                });
                if (!res.ok) throw new Error(`Chunk ${index} failed`);
            } catch (err) {
                console.warn(`Chunk ${index} failed, retrying...`, err);
                await retryChunk(host, buildFormData, index);
            }

            uploadedChunks++;
            const progress = Math.round((uploadedChunks / totalChunks) * 100);
            const speedMbps = ((uploadedChunks * CHUNK_SIZE) / (1024 * 1024) / ((Date.now() - startTime) / 1000)).toFixed(1);

            // ✅ NEW: Update the visual progress bar alongside the status text
            if (progressBar) progressBar.value = progress;
            if (progressText) progressText.textContent = `${progress}%`;

            statusValue.textContent = `Vortex Engine: ${progress}% (${speedMbps} MB/s)`;
        };

        // Execution Pool (12 parallel streams)
        const queue = Array.from({ length: totalChunks }, (_, i) => i);
        const totalConcurrency = CONCURRENCY_PER_ORIGIN * HOSTS.length;
        const workers = Array(Math.min(totalConcurrency, totalChunks)).fill(null).map(async () => {
            while (queue.length > 0) {
                const index = queue.shift();
                await uploadChunkTask(index);
            }
        });

        await Promise.all(workers);

        // 3. Finalize and Process Metadata
        statusValue.textContent = "Processing Massive Metadata...";
        const compRes = await fetch(`${HOSTS[0]}/complete_upload`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ filename: file.name })
        });
        return await compRes.json();
    }

    // ✅ NEW: Retry failed chunk with exponential backoff (ported from the 372-line version)
    async function retryChunk(host, buildFormData, index, retries = 3) {
        for (let attempt = 0; attempt < retries; attempt++) {
            try {
                await new Promise(resolve => setTimeout(resolve, 100 * Math.pow(2, attempt)));
                const res = await fetch(`${host}/upload_chunk`, {
                    method: "POST",
                    body: buildFormData()
                });
                if (res.ok) return index;
            } catch (err) {
                console.log(`Retry ${attempt + 1} for chunk ${index}`);
            }
        }
        throw new Error(`Chunk ${index} failed after ${retries} retries`);
    }

    function renderMetadata(data) {
        metadataGrid.innerHTML = "";

        const meta = data.full_metadata || {};
        const size = meta.size ? `${meta.size[0]} x ${meta.size[1]}` : "N/A";
        const proj = meta.coordinateSystem ? meta.coordinateSystem.wkt.split('"')[1] : "WGS 84";
        const extension = (data.name || "").split(".").pop().toUpperCase();
        const format = extension === "SID" ? "SID" :
            (extension === "TIF" || extension === "TIFF" ? "TIF" : (meta.driverShortName || "N/A"));

        const items = [
            { label: "Filename", value: data.name },
            { label: "Location", value: data.center ? `${data.center.lat.toFixed(4)}, ${data.center.lon.toFixed(4)}` : "Unavailable" },
            { label: "Resolution", value: size },
            { label: "Projection", value: proj },
            { label: "Format", value: format },
            { label: "Bounds N", value: data.bounds ? data.bounds.maxLat.toFixed(4) : "N/A" }
        ];

        items.forEach(item => {
            const div = document.createElement("div");
            div.className = "meta-item";
            div.innerHTML = `
                <div class="meta-label">${item.label}</div>
                <div class="meta-value" title="${item.value}">${item.value}</div>
            `;
            metadataGrid.appendChild(div);
        });
    }

    document.getElementById("showMap").addEventListener("click", () => {
        if (mapDataList.length === 0) {
            alert("No imagery data processed yet!");
            return;
        }

        mapOpened = true;
        chrome.storage.local.set({ mapDataList }, () => {
            chrome.tabs.create({ url: chrome.runtime.getURL("map.html") });
        });
    });

    document.getElementById("clearBtn").addEventListener("click", async () => {
        try {
            await fetch(`${backendUrl}/cleanup`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({})
            });
        } catch (e) {
            console.error("Cleanup failed:", e);
        }
        await new Promise(resolve => chrome.storage.local.remove("mapDataList", resolve));
        location.reload();
    });

    window.addEventListener("beforeunload", () => {
        if (!mapOpened && mapDataList.length > 0) {
            mapDataList.forEach(data => {
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
        }
    });

    // ✅ ZOOM BUTTONS
    document.getElementById("zoomIn").addEventListener("click", () => {
        zoomLevel += 0.5;
        img.style.transform = `scale(${zoomLevel})`;
    });

    document.getElementById("zoomOut").addEventListener("click", () => {
        zoomLevel = Math.max(0.5, zoomLevel - 0.5);
        img.style.transform = `scale(${zoomLevel})`;
    });

    document.getElementById("resetZoom").addEventListener("click", () => {
        zoomLevel = 2.5;
        img.style.transform = `scale(${zoomLevel})`;
    });
});
