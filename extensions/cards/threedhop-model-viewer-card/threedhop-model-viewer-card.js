import ko from 'knockout';
import arches from 'arches';
import CardComponentViewModel from 'viewmodels/card-component';
import threedHopViewerTemplate from 'templates/views/components/cards/threedhop-model-viewer-card.htm';

const scriptLoadPromises = {};

const DEFAULTS = {
    viewerEmptyMessage: 'No model file available. Add a supported 3DHOP file to the file-list widget for this node.',
    extensionVersion: '0.1.0',
};

const MODEL_INSTANCE_NAME = 'model_1';

const LIBRARY_PATHS = {
    spiderglUrl: 'js/views/components/cards/threedhop-model-viewer-card/vendor/3dhop/spidergl.js',
    jqueryUrl: 'js/views/components/cards/threedhop-model-viewer-card/vendor/3dhop/jquery.js',
    presenterUrl: 'js/views/components/cards/threedhop-model-viewer-card/vendor/3dhop/presenter.js',
    nexusUrl: 'js/views/components/cards/threedhop-model-viewer-card/vendor/3dhop/nexus.js',
    plyUrl: 'js/views/components/cards/threedhop-model-viewer-card/vendor/3dhop/ply.js',
    trackballTurntableUrl: 'js/views/components/cards/threedhop-model-viewer-card/vendor/3dhop/trackball_turntable.js',
    trackballTurntablePanUrl: 'js/views/components/cards/threedhop-model-viewer-card/vendor/3dhop/trackball_turntable_pan.js',
    trackballPantiltUrl: 'js/views/components/cards/threedhop-model-viewer-card/vendor/3dhop/trackball_pantilt.js',
    trackballSphereUrl: 'js/views/components/cards/threedhop-model-viewer-card/vendor/3dhop/trackball_sphere.js',
};

const getScriptPathCandidates = function(path) {
    if (!path) {
        return [];
    }
    return [path];
};

const loadScriptOnce = function(url) {
    if (!url) {
        return Promise.resolve();
    }

    if (scriptLoadPromises[url]) {
        return scriptLoadPromises[url];
    }

    const existing = document.querySelector('script[src="' + url + '"]');
    if (existing) {
        if (existing.dataset.loaded === 'true') {
            scriptLoadPromises[url] = Promise.resolve();
            return scriptLoadPromises[url];
        }

        scriptLoadPromises[url] = new Promise(function(resolve, reject) {
            const onLoad = function() {
                existing.dataset.loaded = 'true';
                existing.removeEventListener('load', onLoad);
                existing.removeEventListener('error', onError);
                resolve();
            };

            const onError = function() {
                existing.removeEventListener('load', onLoad);
                existing.removeEventListener('error', onError);
                delete scriptLoadPromises[url];
                reject(new Error('Could not load script: ' + url));
            };

            existing.addEventListener('load', onLoad);
            existing.addEventListener('error', onError);
        });

        return scriptLoadPromises[url];
    }

    scriptLoadPromises[url] = new Promise(function(resolve, reject) {
        const script = document.createElement('script');
        script.src = url;
        script.async = true;
        script.onload = function() {
            script.dataset.loaded = 'true';
            resolve();
        };
        script.onerror = function() {
            delete scriptLoadPromises[url];
            reject(new Error('Could not load script: ' + url));
        };
        document.head.appendChild(script);
    });

    return scriptLoadPromises[url];
};

const getPresenterCtor = function() {
    if (window.Presenter) {
        return window.Presenter;
    }

    try {
        const ctor = Function('return typeof Presenter !== "undefined" ? Presenter : null;')();
        if (ctor) {
            window.Presenter = ctor;
        }
        return ctor;
    } catch (e) {
        return null;
    }
};

const getTrackballCtor = function(name) {
    if (window[name]) {
        return window[name];
    }

    try {
        return Function('return typeof ' + name + ' !== "undefined" ? ' + name + ' : null;')();
    } catch (e) {
        return null;
    }
};

const setDefaultObservable = function(target, key, value) {
    if (!ko.isObservable(target[key])) {
        target[key] = ko.observable(value);
    }
};

const getFullscreenElement = function() {
    return document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement || null;
};

const getFileExtension = function(name) {
    return (ko.unwrap(name) || '').split('.').pop().toLowerCase();
};

const resolveStaticUrl = function(path) {
    const base = arches.urls.media || '/static/';
    return base.endsWith('/') ? base + path : base + '/' + path;
};

const loadScriptWithFallback = async function(path) {
    const candidates = getScriptPathCandidates(path).map(resolveStaticUrl);
    let lastError = null;

    for (let i = 0; i < candidates.length; i += 1) {
        try {
            await loadScriptOnce(candidates[i]);
            return;
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError || new Error('Could not load script for path: ' + path);
};

const viewModel = function(params) {
    const self = this;

    params.configKeys = ['viewerEmptyMessage', 'extensionVersion'];

    CardComponentViewModel.apply(this, [params]);

    Object.keys(DEFAULTS).forEach(function(key) {
        setDefaultObservable(self, key, DEFAULTS[key]);
    });

    const getFileListNodeId = function() {
        const nodes = params.card.model.nodes();
        const cardNodegroupId = ko.unwrap(params.card.model.nodegroup_id);
        const fileListNodes = nodes.filter(function(node) {
            const nodeGroupId = ko.unwrap(node.nodeGroupId) || ko.unwrap(node.nodegroup_id);
            return node.datatype() === 'file-list' && nodeGroupId === cardNodegroupId;
        });
        return fileListNodes.length ? fileListNodes[0].nodeid : null;
    };

    this.fileListNodeId = getFileListNodeId();

    this.viewerContainerId = 'threedhop-viewer-' + Math.random().toString(36).slice(2, 10);
    this.modelFile = ko.observable(null);
    this.viewerStatus = ko.observable('idle');
    this.viewerMessage = ko.observable('');
    this.isFullscreen = ko.observable(false);
    this.isLightOn = ko.observable(false);
    this.isTextureOn = ko.observable(true);
    this.isMeasuring = ko.observable(false);
    this.measurementResult = ko.observable(null);

    this.presenter = null;
    this.canvas = null;
    this._container = null;
    this._resizeHandler = null;
    this._fullscreenHandler = null;
    this._dataSubscription = null;
    this._tilesSubscription = null;
    this._tilesDataSubscription = null;
    this._fileSignature = null;
    this._mountGeneration = 0;

    this.cleanUrl = function(url) {
        if (!url) {
            return url;
        }

        const httpRegex = /^https?:\/\//;
        if (httpRegex.test(url) || url.startsWith(arches.urls.url_subpath)) {
            return url;
        }

        return (arches.urls.url_subpath + url).replace('//', '/');
    };

    this.getActiveTile = function() {
        const tiles = self.card.tiles();
        return tiles.find(function(tile) {
            return tile.selected && tile.selected() === true;
        }) || tiles[0] || null;
    };

    this.normalizeFileEntries = function(value) {
        const unwrapped = ko.unwrap(value);
        if (!unwrapped) {
            return [];
        }
        if (Array.isArray(unwrapped)) {
            return unwrapped;
        }
        if (Array.isArray(unwrapped.files)) {
            return unwrapped.files;
        }
        return [unwrapped];
    };

    this.resolveModelFile = function() {
        if (!self.fileListNodeId) {
            return null;
        }

        const tile = self.getActiveTile();
        if (!tile) {
            return null;
        }

        const entries = self.normalizeFileEntries(tile.data[self.fileListNodeId]);
        return entries[0] || null;
    };

    this.modelUrl = ko.computed(function() {
        const file = self.modelFile();
        if (!file) {
            return '';
        }

        return self.cleanUrl(ko.unwrap(file.url)) || self.cleanUrl(ko.unwrap(file.content)) || '';
    });

    this.getFileSignature = function(file) {
        if (!file) {
            return '';
        }

        return [
            ko.unwrap(file.file_id) || ko.unwrap(file.fileid) || '',
            ko.unwrap(file.name) || '',
            ko.unwrap(file.url) || ko.unwrap(file.content) || '',
        ].join('::');
    };

    this.getContainer = function() {
        return document.getElementById(self.viewerContainerId);
    };

    this.destroyViewer = function() {
        if (self._resizeHandler) {
            window.removeEventListener('resize', self._resizeHandler);
            self._resizeHandler = null;
        }

        if (self._fullscreenHandler) {
            document.removeEventListener('fullscreenchange', self._fullscreenHandler);
            self._fullscreenHandler = null;
        }

        self.presenter = null;
        self.isLightOn(false);
        self.isTextureOn(true);
        self.isMeasuring(false);
        self.measurementResult(null);

        if (self.canvas && self.canvas.parentNode) {
            self.canvas.parentNode.removeChild(self.canvas);
        }

        self.canvas = null;
        self._container = null;
    };

    this.resetView = function() {
        if (self.presenter && typeof self.presenter.resetTrackball === 'function') {
            self.presenter.resetTrackball();
        }
    };

    this.zoomIn = function() {
        if (self.presenter && typeof self.presenter.zoomIn === 'function') {
            self.presenter.zoomIn();
        }
    };

    this.zoomOut = function() {
        if (self.presenter && typeof self.presenter.zoomOut === 'function') {
            self.presenter.zoomOut();
        }
    };

    this.toggleLight = function() {
        if (!self.presenter || typeof self.presenter.enableLightTrackball !== 'function') {
            return;
        }
        const on = !self.isLightOn();
        self.presenter.enableLightTrackball(on);
        self.isLightOn(on);
    };

    this.toggleTexture = function() {
        if (!self.presenter || typeof self.presenter.setInstanceSolidColorByName !== 'function') {
            return;
        }

        const on = !self.isTextureOn();
        self.presenter.setInstanceSolidColorByName(MODEL_INSTANCE_NAME, !on, true, [1.0, 1.0, 1.0]);
        self.isTextureOn(on);
    };

    this.toggleMeasure = function() {
        if (!self.presenter || typeof self.presenter.enableMeasurementTool !== 'function') {
            return;
        }
        const on = !self.isMeasuring();
        if (on) {
            self.measurementResult(null);
        }
        self.presenter.enableMeasurementTool(on);
        self.isMeasuring(on);
    };

    this.toggleFullscreen = function() {
        const container = self._container || self.getContainer();
        if (!container) {
            return;
        }

        if (getFullscreenElement()) {
            const exitFullscreen = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen || document.msExitFullscreen;
            if (exitFullscreen) {
                exitFullscreen.call(document);
            }
            self.isFullscreen(false);
            return;
        }

        const requestFullscreen = container.requestFullscreen || container.webkitRequestFullscreen || container.mozRequestFullScreen || container.msRequestFullscreen;
        if (requestFullscreen) {
            requestFullscreen.call(container);
            self.isFullscreen(true);
        }
    };

    this.attachResizeHandlers = function() {
        const container = self._container;
        const canvas = self.canvas;

        if (!container || !canvas) {
            return;
        }

        self._resizeHandler = function() {
            const width = container.clientWidth || 800;
            const height = container.clientHeight || 400;
            canvas.width = width;
            canvas.height = height;

            if (self.presenter && self.presenter.ui && typeof self.presenter.ui.postDrawEvent === 'function') {
                self.presenter.ui.postDrawEvent();
            } else if (self.presenter && typeof self.presenter.repaint === 'function') {
                self.presenter.repaint();
            }
        };

        window.addEventListener('resize', self._resizeHandler);

        self._fullscreenHandler = function() {
            self.isFullscreen(!!getFullscreenElement());
            self._resizeHandler();
        };

        document.addEventListener('fullscreenchange', self._fullscreenHandler);
        self._resizeHandler();
    };

    this.mountCanvas = function() {
        const container = self.getContainer();
        if (!container) {
            throw new Error('Viewer container element not found in the DOM.');
        }

        self._container = container;
        self.canvas = document.createElement('canvas');
        self.canvas.id = self.viewerContainerId + '-canvas';
        self.canvas.style.width = '100%';
        self.canvas.style.height = '100%';
        self.canvas.style.display = 'block';
        self.canvas.style.background = '#1e1e2e';
        container.innerHTML = '';
        container.appendChild(self.canvas);
    };

    this.loadLibraries = async function() {
        await loadScriptWithFallback(LIBRARY_PATHS.spiderglUrl);
        await loadScriptWithFallback(LIBRARY_PATHS.jqueryUrl);
        await loadScriptWithFallback(LIBRARY_PATHS.presenterUrl);
        await loadScriptWithFallback(LIBRARY_PATHS.nexusUrl);
        await loadScriptWithFallback(LIBRARY_PATHS.plyUrl);
        await loadScriptWithFallback(LIBRARY_PATHS.trackballTurntableUrl);
        await loadScriptWithFallback(LIBRARY_PATHS.trackballTurntablePanUrl);
        await loadScriptWithFallback(LIBRARY_PATHS.trackballPantiltUrl);
        await loadScriptWithFallback(LIBRARY_PATHS.trackballSphereUrl);
    };

    this.buildSceneOptions = function(modelUrl, fileExt) {
        const turnTableTrackball = getTrackballCtor('TurnTableTrackball');

        // Arches file URLs have no extension (e.g. /files/<uuid>), so mType
        // must be set explicitly — presenter.js infers it from the URL extension
        // which will always be wrong for Arches-served files.
        const mType = (fileExt === 'ply') ? 'ply' : 'nexus';

        const options = {
            meshes: {
                model_1: { url: modelUrl, mType: mType },
            },
            modelInstances: {
                model_1: { mesh: MODEL_INSTANCE_NAME },
            },
            space: {
                centerMode: 'specific',
                whichInstanceCenter: MODEL_INSTANCE_NAME,
                radiusMode: 'scene',
            },
        };

        if (turnTableTrackball) {
            options.trackball = {
                type: turnTableTrackball,
                trackOptions: {
                    startPhi: 35.0,
                    startTheta: 15.0,
                    startDistance: 0.5,
                    minMaxPhi: [-180, 180],
                    minMaxTheta: [-30.0, 70.0],
                    minMaxDist: [0.1, 3.0],
                },
            };
        }

        return options;
    };

    this.loadPresenter = async function(modelUrl, fileExt, generation) {
        await self.loadLibraries();

        // Bail out if a newer mount has started while we were loading libraries.
        if (self._mountGeneration !== generation) { return; }

        const PresenterCtor = getPresenterCtor();
        if (!PresenterCtor) {
            throw new Error('3DHOP Presenter is not available after loading the viewer scripts.');
        }

        self.mountCanvas();

        // Defer until the browser has done a layout pass so clientWidth/Height
        // reflect actual pixel dimensions (aspect-ratio containers are 0-height
        // until the browser resolves them from their parent's width).
        await new Promise(function(resolve) { requestAnimationFrame(resolve); });
        await new Promise(function(resolve) { requestAnimationFrame(resolve); });

        // Bail out again after rAF delay — another mount may have started.
        if (self._mountGeneration !== generation) { return; }

        const container = self._container;
        const w = container.clientWidth || container.offsetWidth || 800;
        const h = container.clientHeight || container.offsetHeight || Math.round(w * 0.75);
        self.canvas.width = Math.max(w, 1);
        self.canvas.height = Math.max(h, 1);

        self.presenter = new PresenterCtor(self.canvas.id);

        if (!self.presenter || typeof self.presenter.setScene !== 'function') {
            throw new Error('3DHOP Presenter failed to initialize.');
        }

        self.presenter.setScene(self.buildSceneOptions(modelUrl, fileExt));
        self.isTextureOn(true);

        // Hook measurement callback to surface result in the UI.
        self.presenter._onEndMeasurement = function(distance) {
            self.measurementResult(distance.toFixed(4));
        };

        self.attachResizeHandlers();
    };

    this.mountViewer = async function(file) {
        self.destroyViewer();

        if (!file) {
            self.viewerStatus('idle');
            self.viewerMessage(self.viewerEmptyMessage());
            return;
        }

        const modelUrl = self.modelUrl();
        const ext = getFileExtension(file.name);

        if (!modelUrl) {
            self.viewerStatus('error');
            self.viewerMessage('A file was found but no URL is available yet. Save the tile and try again.');
            return;
        }

        const supported = ext === 'nxs' || ext === 'nxz' || ext === 'ply';
        if (!supported) {
            self.viewerStatus('error');
            self.viewerMessage('3DHOP supports NXS, NXZ, and PLY files. The selected file type is not supported by this viewer.');
            return;
        }

        const generation = ++self._mountGeneration;

        try {
            self.viewerStatus('loading');
            self.viewerMessage('Loading 3DHOP viewer...');
            await self.loadPresenter(modelUrl, ext, generation);
            // If superseded by a newer mount, do not update status.
            if (self._mountGeneration !== generation) { return; }
            self.viewerStatus('ready');
            self.viewerMessage('');
        } catch (error) {
            if (self._mountGeneration !== generation) { return; }
            self.viewerStatus('error');
            self.viewerMessage(error.message || 'Failed to load the 3DHOP viewer.');
        }
    };

    this.refreshViewer = function() {
        const file = self.resolveModelFile();
        const nextSignature = self.getFileSignature(file);

        if (nextSignature === self._fileSignature) {
            return;
        }

        self.modelFile(file);
        self.mountViewer(file).then(function() {
            // only lock in the signature if mounting didn't fail with a DOM error
            if (self.viewerStatus() !== 'error' || !self.viewerMessage().includes('not found in the DOM')) {
                self._fileSignature = nextSignature;
            }
        });
    };

    const subscribeToActiveTileData = function() {
        if (self._dataSubscription) {
            self._dataSubscription.dispose();
            self._dataSubscription = null;
        }

        const nodeId = self.fileListNodeId;
        const tile = self.getActiveTile();
        if (tile && nodeId && ko.isObservable(tile.data[nodeId])) {
            self._dataSubscription = tile.data[nodeId].subscribe(self.refreshViewer);
        }
    };

    self._tilesSubscription = self.card.tiles.subscribe(self.refreshViewer);
    self._tilesDataSubscription = self.card.tiles.subscribe(subscribeToActiveTileData);

    subscribeToActiveTileData();
    self.refreshViewer();

    this.dispose = function() {
        if (self._dataSubscription) {
            self._dataSubscription.dispose();
            self._dataSubscription = null;
        }

        if (self._tilesSubscription) {
            self._tilesSubscription.dispose();
            self._tilesSubscription = null;
        }

        if (self._tilesDataSubscription) {
            self._tilesDataSubscription.dispose();
            self._tilesDataSubscription = null;
        }

        if (self.modelUrl && typeof self.modelUrl.dispose === 'function') {
            self.modelUrl.dispose();
        }

        self.destroyViewer();
    };
};

export default ko.components.register('threedhop-model-viewer-card', {
    viewModel: viewModel,
    template: threedHopViewerTemplate,
});