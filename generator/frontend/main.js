;(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);throw new Error("Cannot find module '"+o+"'")}var f=n[o]={exports:{}};t[o][0].call(f.exports,function(e){var n=t[o][1][e];return s(n?n:e)},f,f.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
var EventEmitter = require('events').EventEmitter;
var inherits = require('inherits');

function DataSource(filePath) {
    this.setProperties(filePath);
}

module.exports = DataSource;
inherits(DataSource, EventEmitter);

// --- External API ---
DataSource.prototype.stageUpdate = function () {
    if (this.updating) return;

    this.update();
};

// --- Internal API ---
DataSource.prototype.setProperties = function (filePath) {
    this.filePath = filePath;
};

DataSource.prototype.update = function () {
    this.updating = true;

    var self = this;
    loadFile(this.filePath, this.etag, function (err, data, etag) {
        if (!err) {
            self.etag = etag;
            self.publishData(data);
        } else {
            switch (err) {
                case 'FileNotModifiedError':
                    break;
                case 'FileNotFoundError':
                    self.publishError(err, 'Could not find ' + self.filePath);
                default:
                    self.publishError(err);
            }
        }

        self.updating = false;
    });
};

DataSource.prototype.publishData = function (data) {
    this.emit('data', data);
};

DataSource.prototype.publishError = function (name, message) {
    var err = new Error(message || 'Unknown error');
    err.name = name;

    this.emit('error', err);

    return err;
};

function loadFile(filePath, etag, callback) {
    if (!callback) {
        callback = etag;
        etag = undefined;
    }

    var request = new XMLHttpRequest();

    request.onreadystatechange = function() {
        if (request.readyState == 4) {
            if (request.status == 304) {
                callback('FileNotModifiedError');
            } else if (request.status == 200 || (request.status == 0 && request.response)) {
                callback(null, request.responseText, request.getResponseHeader('etag'));
            } else {
                callback('FileNotFoundError');
            }
        }
    }

    request.open('GET', filePath + '?' + new Date().valueOf(), true);
    if (etag) {
        request.setRequestHeader('If-None-Match', etag);
    }
    request.send();
}

},{"events":38,"inherits":8}],2:[function(require,module,exports){
var DataSource = require('./DataSource');
var inherits = require('inherits');

// --- Constants ---
var INDEX_PATTERN = /([^;\r\n]*);([^;]*);([^;]*);([^;]*);([^;]*);([^;]*);([^;]*);([^;]*);;([^;\r]*)/g;

function IndexSource(filePath, refresh) {
    this.setProperties(filePath, refresh);
}

module.exports = IndexSource;
inherits(IndexSource, DataSource);

IndexSource.prototype.setup = function () {
};

IndexSource.prototype.publishData = function (data) {
    try {
        this.emit('data', parseIndex(data));
    } catch (err) {
        if (err.name === 'TypeError') {
            this.publishError('IndexParsingError', 'Failed parsing index data');
        } else {
            this.publishError(err);
        }
    }
};

IndexSource.prototype.publishError = function (name, message) {
    if (name === 'FileNotFoundError') {
        message = 'Could not find index file at ' + this.filePath;
    }

    DataSource.prototype.publishError.apply(this, [name, message]);
};

function parseIndex(data) {
    INDEX_PATTERN.lastIndex = 0;
    var cards = [];

    for (var indexMatch; indexMatch = INDEX_PATTERN.exec(data);) {
        cards.push({
            range:indexMatch[1],
            relay:indexMatch[2],
            lane:indexMatch[3],
            name:indexMatch[4],
            club:indexMatch[5],
            className:indexMatch[6],
            category:indexMatch[7],
            startsum:indexMatch[8],
            targetID:indexMatch[9]
        });
    }

    return cards;
}

},{"./DataSource":1,"inherits":8}],3:[function(require,module,exports){
var EventEmitter = require('events').EventEmitter;
var inherits = require('inherits');
var VersionWatcher = require('./VersionWatcher');
var IndexSource = require('./IndexSource');
var SeriesSource = require('./SeriesSource');
var LiveShot = require('liveshot-protocol');
var CardBuilder = LiveShot.CardBuilder;
var RangeBuilder = LiveShot.RangeBuilder;

// --- CONSTANTS ---
var VERSION_REFRESH = 1000;
var VERSION_PATH = 'version.txt';
var INDEX_PATH = 'index.txt';
var CARD_EXT = '.txt';
var TARGET_MAP = {
    '30':{
        id:'NO_DFS_15M',
        scale:41500,
        gaugeSize:4000/41500
    },
    '31':{
        id:'NO_DFS_100M',
        scale:300000,
        gaugeSize:4000/300000
    },
    '32':{
        id:'NO_DFS_200M',
        scale:500000,
        gaugeSize:4000/500000
    },
    '33':{
        id:'NO_DFS_300M',
        scale:750000,
        gaugeSize:4000/750000
    },
    'XXX':{
        id:'UNKNOWN',
        scale:1000000,
        gaugeSize:10000/1000000
    }
};

var DEFAULT_TARGET = TARGET_MAP['XXX'];

function MegalinkWatcher(root) {
    this.root = root || '.';
    this.setup();
}

module.exports = MegalinkWatcher;
inherits(MegalinkWatcher, EventEmitter);

// --- External API ---
MegalinkWatcher.prototype.start = function () {
    this.watcher.start();
};

MegalinkWatcher.prototype.stop = function () {
    this.watcher.stop();
};

// --- Internal API ---
MegalinkWatcher.prototype.setup = function () {
    this.watcher = new VersionWatcher(this.getVersionPath(), VERSION_REFRESH);

    var self = this;
    this.watcher.once('cards', function (cardData) {
        self.setupCards(cardData);
        self.setupSources();
        self.stageUpdate();

        self.watcher.on('update', function (file) {
            self.sources[file].stageUpdate();
        });
    });
};

MegalinkWatcher.prototype.setupCards = function (data) {
    this.ranges = {};

    for (var idx in data) {
        var cardData = data[idx];

        if (!this.ranges.hasOwnProperty(cardData.range)) {
            this.ranges[cardData.range] = {
                builder:new RangeBuilder().setName(cardData.range),
                cards:{}
            };
        }

        this.ranges[cardData.range].cards[cardData.lane] = {
            watcher:this.setupCardSource(cardData),
            builder:new CardBuilder().setLane(cardData.lane)
        };
    }

    this.publishUpdate();
};

MegalinkWatcher.prototype.setupSources = function () {
    this.sources = {};
    this.sources[INDEX_PATH] = new IndexSource(this.getIndexPath());

        var self = this;
    this.sources[INDEX_PATH].on('data', function (data) {
        self.updateIndex(data);
    });

    for (var range in this.ranges) {
        for (var lane in this.ranges[range].cards) {
            var file = this.getCardFile(range, lane);
            this.sources[file] = this.setupCardSource(range, lane);
        }
    }
};

MegalinkWatcher.prototype.setupCardSource = function (range, lane) {
    var source = new SeriesSource(this.getCardPath(range, lane));

    var self = this;
    source.on('data', function (seriesData) {
        self.updateCard(range, lane, seriesData);
    });

    return source;
};

MegalinkWatcher.prototype.updateIndex = function (data) {
    for (var idx in data) {
        var cardData = data[idx];

        // XXX if there is mismatch between index and version, this will fail
        var range = this.ranges[cardData.range];
        var card = range.cards[cardData.lane];
        var target = TARGET_MAP[cardData.targetID]; // XXX targetID might be unknown

        range.builder.setRelay(cardData.relay);

        card.builder
            .setLane(cardData.lane)
            .setName(cardData.name)
            .setClub(cardData.club)
            .setClassName(cardData.className)
            .setCategory(cardData.category)
            .setGaugeSize(target.gaugeSize)
            .setTargetID(target.id);
    }

    this.publishUpdate();
};

MegalinkWatcher.prototype.stageUpdate = function () {
    for (var idx in this.sources) {
        this.sources[idx].stageUpdate();
    }
};

MegalinkWatcher.prototype.updateCard = function (range, lane, data) {
    var card = this.ranges[range].cards[lane];

    card.builder
        .setSeriesName(data.series)
        .setMarking(data.marking)
        .setSeriesSum(data.seriesSum)
        .setTotalSum(data.totalSum)
        .resetShots();

    for (var idx in data.shots) {
        var shot = data.shots[idx];
        card.builder.addShotData(shot.x, shot.y, shot.value);
    }

    this.publishUpdate();
};

MegalinkWatcher.prototype.publishUpdate = function () {
    var ranges = [];

    for (var idx in this.ranges) {
        var range = this.ranges[idx];
        range.builder.resetCards();

        for (var idx in range.cards) {
            var card = range.cards[idx];

            range.builder.addCard(card.builder.getCard());
        }

        ranges.push(range.builder.getRange());
    }

    this.emit('update', ranges);
};

MegalinkWatcher.prototype.getVersionPath = function () {
    return this.getPath(VERSION_PATH);
};

MegalinkWatcher.prototype.getIndexPath = function () {
    return this.getPath(INDEX_PATH);
};

MegalinkWatcher.prototype.getCardPath = function (range, lane) {
    return this.getPath(this.getCardFile(range, lane));
};

MegalinkWatcher.prototype.getCardFile = function (range, lane) {
    return range + '_' + lane + CARD_EXT;
};

MegalinkWatcher.prototype.getPath = function (file) {
    return this.root + '/' + file;
};

},{"./IndexSource":2,"./SeriesSource":4,"./VersionWatcher":5,"events":38,"inherits":8,"liveshot-protocol":29}],4:[function(require,module,exports){
var DataSource = require('./DataSource');
var inherits = require('inherits');

// --- Constants ----
var SHOT_PATTERN = /\[(\d+)\]\r\nX=(.+)\r\nY=(.+)\r\nV=(.+)/mg;
var SERIES_NUM_PATTERN = /Nr=(\d+)/;
var SERIES_NAME_PATTERN = /Name=[\s]*(.*)/;
var MARKING_PATTERN = /Marking=(.*)/;
var SERIES_SUM_PATTERN = /Series=(.*)/;
var TOTAL_SUM_PATTERN = /Total=(.*)/;
var SHOT_COUNT_PATTERN = /Count=(\d+)/;

function SeriesSource(filePath) {
    this.setProperties(filePath);
}

module.exports = SeriesSource;
inherits(SeriesSource, DataSource);

SeriesSource.prototype.publishData = function (data) {
    try {
        this.emit('data', parseSeries(data));
    } catch (err) {
        if (err.name === 'TypeError') {
            this.publishError('SeriesParsingError', 'Failed parsing series data');
        } else {
            this.publishError(err);
        }
    }
};

SeriesSource.prototype.publishError = function (name, message) {
    if (name === 'FileNotFoundError') {
        message = 'Could not find series data file at ' + this.filePath;
    }

    DataSource.prototype.publishError.apply(this, [name, message]);
};

function parseSeries(data) {
    var result = {
        seriesNum:parseInt(data.match(SERIES_NUM_PATTERN)[1]),
        series:data.match(SERIES_NAME_PATTERN)[1],
        marking:data.match(MARKING_PATTERN)[1] == 'True',
        seriesSum:data.match(SERIES_SUM_PATTERN)[1],
        totalSum:data.match(TOTAL_SUM_PATTERN)[1],
        numShots:parseInt(data.match(SHOT_COUNT_PATTERN)[1]),
        shots:[]
    };

    SHOT_PATTERN.lastIndex = 0;

    for (var i = 0; i < result.numShots; ++i) {
        var shotMatch = SHOT_PATTERN.exec(data);

        result.shots[parseInt(shotMatch[1])-1] = {
            x:Number(shotMatch[2]),
            y:Number(shotMatch[3]),
            value:shotMatch[4]
        };
    }

    return result;
}

},{"./DataSource":1,"inherits":8}],5:[function(require,module,exports){
var Watcher = require('./Watcher');
var inherits = require('inherits');

// --- Constants ---
var VERSION_PATTERN = /([^;\r\n]*);(\d*)/g;
var SERIES_PATTERN = /([^_\r\n]*)_([^\.]*).txt/;
var INDEX_FILE = 'index.txt';

function VersionWatcher(filePath, refresh) {
    this.setProperties(filePath, refresh);
    this.setup();
}

module.exports = VersionWatcher;
inherits(VersionWatcher, Watcher);

// --- Internal API ---
VersionWatcher.prototype.setup = function () {
    this.versions = {};
};

VersionWatcher.prototype.publishData = function (data) {
    try {
        this.updateVersion(parseVersion(data));
    } catch (err) {
        if (err.name === 'TypeError') {
            this.publishError('VersionParsingError', 'Failed parsing version data');
        } else {
            this.publishError(err);
        }
    }
};

VersionWatcher.prototype.publishError = function (name, message) {
    if (name === 'FileNotFoundError') {
        message = 'Could not find version file at ' + this.filePath;
    }

    Watcher.prototype.publishError.apply(this, [name, message]);
};

VersionWatcher.prototype.updateVersion = function (versions) {
    var cards = [];

    for (var file in versions) {
        var version = versions[file];
        var oldVersion = this.versions[file];

        if (version != oldVersion) {
            this.versions[file] = version;

            this.emit('update', file);
        }

        var match = SERIES_PATTERN.exec(file);
        if (match) {
            cards.push({lane:match[2], range:match[1]});
        }
    }

    this.emit('cards', cards);
};

function parseVersion(data) {
    var versions = {};
    VERSION_PATTERN.lastIndex = 0;

    for (var match; match = VERSION_PATTERN.exec(data);) {
        versions[match[1]] = match[2];
    }

    return versions;
}

},{"./Watcher":6,"inherits":8}],6:[function(require,module,exports){
var DataSource = require('./DataSource');
var inherits = require('inherits');

var REFRESH = 1000;

function Watcher(filePath, refresh) {
    this.setProperties(filePath, refresh);
}

module.exports = Watcher;
inherits(Watcher, DataSource);

// --- External API ---
Watcher.prototype.start = function () {
    var self = this;
    this.interval = setInterval(function () {
        self.stageUpdate();
    }, this.refresh);

    this.stageUpdate();
};

Watcher.prototype.stop = function () {
    clearInterval(this.interval);
};

// --- Internal API ---
Watcher.prototype.setProperties = function (filePath, refresh) {
    DataSource.prototype.setProperties.apply(this, [filePath]);

    this.refresh = refresh || REFRESH;
};

},{"./DataSource":1,"inherits":8}],7:[function(require,module,exports){
var LiveShot = require('liveshot-dom');
var MegalinkWatcher = require('./MegalinkWatcher');

// setup scale
if (window.devicePixelRatio) {
    var meta = document.head.getElementsByTagName('meta')[0];
    meta.content = 'width=device-width, user-scalable=no, initial-scale=' + (1/window.devicePixelRatio);
}

// setup views
var rangeView = new LiveShot.MegalinkRangeView();
document.body.appendChild(rangeView.el);

var watcher = new MegalinkWatcher();
watcher.on('update', function (ranges) {
    if (ranges.length > 0) {
        rangeView.setRange(ranges[0], true);
        hideSpinner();
    } else {
        document.body.innerHTML = 'Waiting for data...';
    }
});

setSpinnerLabel('Laster skiver');
watcher.start();

updateSize();
window.onresize = updateSize;

function updateSize() {
    var width = window.innerWidth || document.documentElement.clientWidth || document.body.clientWidth;
    var height = window.innerHeight || document.documentElement.clientHeight || document.body.clientHeight;

    rangeView.el.style.width = width + 'px';
    rangeView.el.style.height = height + 'px';

    rangeView.updateSize();
    rangeView.draw();
}

},{"./MegalinkWatcher":3,"liveshot-dom":9}],8:[function(require,module,exports){
if (typeof Object.create === 'function') {
  // implementation from standard node.js 'util' module
  module.exports = function inherits(ctor, superCtor) {
    ctor.super_ = superCtor
    ctor.prototype = Object.create(superCtor.prototype, {
      constructor: {
        value: ctor,
        enumerable: false,
        writable: true,
        configurable: true
      }
    });
  };
} else {
  // old school shim for old browsers
  module.exports = function inherits(ctor, superCtor) {
    ctor.super_ = superCtor
    var TempCtor = function () {}
    TempCtor.prototype = superCtor.prototype
    ctor.prototype = new TempCtor()
    ctor.prototype.constructor = ctor
  }
}

},{}],9:[function(require,module,exports){
module.exports = {
    CanvasView:require('./src/CanvasView'),
    CardView:require('./src/CardView'),
    MegalinkCardView:require('./src/megalink/MegalinkCardView'),
    MegalinkRangeView:require('./src/megalink/MegalinkRangeView')
};

    /*
    CardView:XXX, // abstract

    MegalinkCardView:XXX,

    Requires additions to protocol
    RangeView:XXX, // abstract
    MegalinkRangeView:XXX
        */

},{"./src/CanvasView":25,"./src/CardView":26,"./src/megalink/MegalinkCardView":27,"./src/megalink/MegalinkRangeView":28}],10:[function(require,module,exports){
module.exports = {
    Renderer:require('./src/renderer/Renderer'),
    ShotRenderer:require('./src/renderer/ShotRenderer'),
    TargetRenderer:require('./src/renderer/TargetRenderer'),
    TriangleRenderer:require('./src/renderer/TriangleRenderer'),
    Scaler:require('./src/scaler/Scaler'),
    RingTargetBuilder:require('./src/target/RingTargetBuilder'),
    RingTargetRenderer:require('./src/renderer/RingTargetRenderer'),
    RingTargetScaler:require('./src/scaler/RingTargetScaler'),
    targets:require('./src/target/targets')
};

},{"./src/renderer/Renderer":11,"./src/renderer/RingTargetRenderer":12,"./src/renderer/ShotRenderer":13,"./src/renderer/TargetRenderer":14,"./src/renderer/TriangleRenderer":15,"./src/scaler/RingTargetScaler":16,"./src/scaler/Scaler":17,"./src/target/RingTargetBuilder":18,"./src/target/targets":24}],11:[function(require,module,exports){
function Renderer() {
    this.rect = {
        x:0,
        y:0,
        width:0,
        height:0
    };
}

module.exports = Renderer;

// --- External API ---
Renderer.prototype.render = function () {
    var ctx = this.context;

    ctx.save();

    this.clipContext();
    this.draw();

    ctx.restore();
};

Renderer.prototype.setPosition = function (x, y) {
    this.rect.x = x;
    this.rect.y = y;

    return this;
};

Renderer.prototype.setSize = function (width, height) {
    this.rect.width = width;
    this.rect.height = height;

    return this;
};

Renderer.prototype.setRect = function (rect) {
    this.rect = rect;

    return this;
};

Renderer.prototype.setContext = function (context) {
    this.context = context;

    return this;
};

// --- Internal API ---
Renderer.prototype.centerContext = function () {
    var ctx = this.context;

    ctx.translate(this.rect.x, this.rect.y);
    ctx.translate(this.rect.width/2, this.rect.height/2);
};

Renderer.prototype.draw = function () {
    // to be overloaded
};

Renderer.prototype.clipContext = function () {
    var ctx = this.context;

    ctx.save();
    this.centerContext();

    ctx.beginPath();
    ctx.rect(-this.rect.width/2, -this.rect.height/2, this.rect.width, this.rect.height);
    ctx.closePath();
    ctx.restore();

    ctx.clip();
};

},{}],12:[function(require,module,exports){
var TargetRenderer = require('./TargetRenderer');

function RingTargetRenderer() {
    TargetRenderer.prototype.constructor.apply(this);

    this.style.drawFullTarget = false;
}

RingTargetRenderer.prototype = new TargetRenderer();
RingTargetRenderer.prototype.constructor = RingTargetRenderer;
module.exports = RingTargetRenderer;

// --- External API ---
RingTargetRenderer.prototype.setTarget = function (target) {
    this.target = target;

    return this;
};

// --- Internal API ---
RingTargetRenderer.prototype.drawTarget = function () {
    this.drawBackground();
    this.drawRings();
    this.drawNumbers();
};

RingTargetRenderer.prototype.drawBackground = function () {
    var ctx = this.context;
    var size = this.getSize();

    // draw back
    var backSize = this.getMaxSize();
    ctx.fillStyle = this.style.backColor;

    ctx.beginPath();
    ctx.arc(0, 0, backSize * size, 0, Math.PI*2, true);
    ctx.closePath();
    ctx.fill();

    // draw front
    var frontSize = Math.min(this.target.frontSize, this.getMaxSize());
    ctx.fillStyle = this.style.frontColor;

    ctx.beginPath();
    ctx.arc(0, 0, frontSize * size, 0, Math.PI*2, true);
    ctx.closePath();
    ctx.fill();
};

RingTargetRenderer.prototype.drawRings = function () {
    var ctx = this.context;
    var frontSize = this.target.frontSize;
    var ringSizes = this.target.ringSizes;
    var size = this.getSize();

    for (var idx in ringSizes) {
        var ringSize = ringSizes[idx];

        if (ringSize > this.getMaxSize()) {
            continue;
        }

        if (ringSize > frontSize) {
            ctx.strokeStyle = this.style.frontColor;
        } else {
            ctx.strokeStyle = this.style.backColor;
        }

        ctx.beginPath();
        ctx.arc(0, 0, ringSize * size, 0, Math.PI*2, true);
        ctx.closePath();

        ctx.stroke();
    }
};

RingTargetRenderer.prototype.drawNumbers = function () {
    var ctx = this.context;
    var size = this.getSize();

    for (var i = this.target.numbersFrom; i <= this.target.numbersTo; ++i) {
        var lowerRingSize = this.target.ringSizes[i - 1];
        var upperRingSize = this.target.ringSizes[i];

        if (lowerRingSize > this.getMaxSize()) {
            continue;
        }

        var d = (lowerRingSize + upperRingSize) / 2 * size;

        if (lowerRingSize > this.target.frontSize) {
            ctx.fillStyle = this.style.frontColor;
        } else {
            ctx.fillStyle = this.style.backColor;
        }

        this.drawNumber(i, -d, 0);
        this.drawNumber(i, d, 0);
        this.drawNumber(i, 0, -d);
        this.drawNumber(i, 0, d);
    }
};

RingTargetRenderer.prototype.drawNumber = function (number, dx, dy) {
    var ctx = this.context;
    var size = this.getSize();

    ctx.font = "36px arial";
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";

    ctx.save();
    ctx.translate(dx, dy);
    ctx.scale(1/500 * size, 1/500 * size);

    ctx.fillText(number, 0, 0);

    ctx.restore();
};

RingTargetRenderer.prototype.getSize = function () {
    return this.scale * Math.min(this.rect.width, this.rect.height)/2;
};

RingTargetRenderer.prototype.getMaxSize = function () {
    var maxSize = 1;

    if (!this.style.drawFullTarget)
        maxSize = Math.min(maxSize, 1 / this.scale);

    return maxSize;
};

},{"./TargetRenderer":14}],13:[function(require,module,exports){
var Renderer = require('./Renderer');

var MARKER_SIZE = 1/20;

function ShotRenderer() {
    Renderer.prototype.constructor.apply(this);

    this.initialize();
}

ShotRenderer.prototype = new Renderer();
ShotRenderer.prototype.constructor = ShotRenderer;
module.exports = ShotRenderer;

// --- External API ---
ShotRenderer.prototype.setStyle = function (style) {
    for (var key in this.style) {
        if (style.hasOwnProperty(key))
            this.style[key] = style[key];
    }

    return this;
};

ShotRenderer.prototype.setShots = function (shots) {
    this.shots = shots;

    return this;
};

ShotRenderer.prototype.setScale = function (scale) {
    this.scale = scale;

    return this;
};

// --- Internal API ---
ShotRenderer.prototype.initialize = function () {
    this.scale = 1;
    this.shots = {};
    this.style = {
        gaugeSize:.015,
        gaugeColor:'rgb(0, 0, 0)',
        markerColor:'rgb(0, 255, 0)',
        lastMarkerColor:'rgb(255, 0, 0)'
    };
};

ShotRenderer.prototype.draw = function () {
    var ctx = this.context;
    ctx.save();

    this.centerContext();
    this.drawShots();

    ctx.restore();
};

ShotRenderer.prototype.drawShots = function () {
    // draw first n-1 shots
    var shot = null;
    for (var idx in this.shots) {
        if (shot) {
            this.drawShot(shot, this.style.markerColor);
        }

        shot = this.shots[idx];
    }

    // draw last shot with special color
    if (shot)
        this.drawShot(shot, this.style.lastMarkerColor);
};

ShotRenderer.prototype.drawShot = function (shot, markerColor) {
    var ctx = this.context;
    var scale = this.scale * Math.min(this.rect.width, this.rect.height)/2;

    ctx.save();
    ctx.scale(scale, scale);
    ctx.translate(shot.x, shot.y);

    if (this.style.gaugeSize > .7*MARKER_SIZE) {
        this.renderShotWithoutGauge(shot, markerColor, scale);
    } else {
        this.renderShotWithGauge(shot, markerColor);
    }

    ctx.restore();
};

ShotRenderer.prototype.renderShotWithGauge = function (shot, markerColor) {
    var ctx = this.context;

    // draw marker
    ctx.beginPath();
    ctx.arc(0, 0, MARKER_SIZE, 0, Math.PI*2, true);
    ctx.closePath();

    ctx.fillStyle = markerColor;
    ctx.fill();

    // draw gauge
    ctx.beginPath();
    ctx.arc(0, 0, this.style.gaugeSize, 0, Math.PI*2, true);
    ctx.closePath();

    ctx.fillStyle = this.style.gaugeColor;
    ctx.fill();
};

ShotRenderer.prototype.renderShotWithoutGauge = function (shot, markerColor, scale) {
    var ctx = this.context;
    ctx.save();

    ctx.beginPath();
    ctx.arc(0, 0, this.style.gaugeSize, 0, Math.PI*2, true);
    ctx.closePath();

    ctx.fillStyle = markerColor;
    ctx.fill();

    ctx.scale(1/scale, 1/scale);
    ctx.strokeStyle = this.style.gaugeColor;
    ctx.stroke();

    ctx.restore();
};

},{"./Renderer":11}],14:[function(require,module,exports){
var Renderer = require('./Renderer');

function TargetRenderer() {
    Renderer.prototype.constructor.apply(this);

    this.initialize();
}

TargetRenderer.prototype = new Renderer();
TargetRenderer.prototype.constructor = TargetRenderer;
module.exports = TargetRenderer;

// --- External API ---
TargetRenderer.prototype.setStyle = function (style) {
    for (var key in this.style) {
        if (style.hasOwnProperty(key))
            this.style[key] = style[key];
    }

    return this;
};

TargetRenderer.prototype.setScale = function (scale) {
    this.scale = scale;

    return this;
};

// --- Internal API ---
TargetRenderer.prototype.initialize = function () {
    this.scale = 1;
    this.style = {
        backColor:'rgb(255, 255, 255)',
        frontColor:'rgb(0, 0, 0)'
    };
};

TargetRenderer.prototype.draw = function () {
    var ctx = this.context;
    ctx.save();

    this.centerContext();
    this.drawTarget();

    ctx.restore();
};

TargetRenderer.prototype.drawTarget = function () {
    // to be overloaded
};

},{"./Renderer":11}],15:[function(require,module,exports){
var Renderer = require('./Renderer');

function TriangleRenderer() {
    Renderer.prototype.constructor.apply(this);

    this.initialize();
}

TriangleRenderer.prototype = new Renderer();
TriangleRenderer.prototype.constructor = TriangleRenderer;
module.exports = TriangleRenderer;

// --- External API ---
TriangleRenderer.prototype.setStyle = function (style) {
    for (var key in this.style) {
        if (style.hasOwnProperty(key))
            this.style[key] = style[key];
    }

    return this;
};

// --- Internal API ---
TriangleRenderer.prototype.initialize = function () {
    this.style = {
        color:'rgb(150, 150, 150)',
        borderColor:'rgb(50, 50, 50)',
        size:.2
    };
};

TriangleRenderer.prototype.draw = function () {
    var ctx = this.context;
    var size = this.style.size;

    ctx.save();

    ctx.translate(this.rect.x, this.rect.y);
    ctx.scale(this.rect.width, this.rect.width);

    ctx.beginPath();
    ctx.moveTo(1, 0);
    ctx.lineTo(1 - size, 0);
    ctx.lineTo(1, size);
    ctx.closePath();

    ctx.fillStyle = this.style.color;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(1 - size, 0);
    ctx.lineTo(1, size);
    ctx.closePath();

    ctx.scale(1/this.rect.width, 1/this.rect.width);

    ctx.strokeStyle = this.style.borderColor;
    ctx.stroke();

    ctx.restore();
};

},{"./Renderer":11}],16:[function(require,module,exports){
var Scaler = require('./Scaler');

function RingTargetScaler() {
    Scaler.prototype.constructor.apply(this);
}

RingTargetScaler.prototype = new Scaler();
RingTargetScaler.prototype.constructor = RingTargetScaler;
module.exports = RingTargetScaler;

// --- External API ---
RingTargetScaler.prototype.setTarget = function (target) {
    this.target = target;

    return this;
};

RingTargetScaler.prototype.getScale = function () {
    // find the largest distance from center to shot
    var maxDist = 0;
    var numShots = 0;
    for (var idx in this.shots) {
        var shot = this.shots[idx];
        var r = Math.sqrt(shot.x*shot.x + shot.y*shot.y);

        maxDist = Math.max(maxDist, r);
        ++numShots;
    }

    if (numShots == 0) {
        maxDist = .2;
    }

    // find rings containing all shots
    var ringSizes = [];
    for (var idx in this.target.ringSizes) {
        var ringSize = this.target.ringSizes[idx];

        if (ringSize > maxDist) {
            ringSizes.push(ringSize);
        } else {
            break;
        }
    }

    // scale to one ring larger than the smallest ring containing all shots
    var size = 1;
    if (ringSizes.length > 1) {
        size = ringSizes[ringSizes.length - 2];
    }

    return 1 / size;
};

},{"./Scaler":17}],17:[function(require,module,exports){
function Scaler() {
    this.shots = [];
}

module.exports = Scaler;

// --- External API ---
Scaler.prototype.setShots = function (shots) {
    this.shots = shots;

    return this;
};

Scaler.prototype.getScale = function () {
    // to be overloaded
};

},{}],18:[function(require,module,exports){
function RingTargetBuilder() {
    this.reset();
}

module.exports = RingTargetBuilder;

// --- External API ---
RingTargetBuilder.createBlankTarget = function () {
    var target = {
        ringSizes:[1],
        frontSize:1,
        numbersFrom:1,
        numbersTo:1
    };

    return target;
};

RingTargetBuilder.prototype.reset = function () {
    this.target = this.constructor.createBlankTarget();

    return this;
};

RingTargetBuilder.prototype.getTarget = function () {
    return this.target;
};

RingTargetBuilder.prototype.setRingSizes = function (ringSizes) {
    this.target.ringSizes = ringSizes;

    return this;
};

RingTargetBuilder.prototype.setFrontSize = function (frontSize) {
    this.target.frontSize = frontSize;

    return this;
};

RingTargetBuilder.prototype.setNumbersFrom = function (numbersFrom) {
    this.target.numbersFrom = numbersFrom;

    return this;
};

RingTargetBuilder.prototype.setNumbersTo = function (numbersTo) {
    this.target.numbersTo = numbersTo;

    return this;
};

},{}],19:[function(require,module,exports){
var RingTargetBuilder = require('../RingTargetBuilder');

module.exports = new RingTargetBuilder()
        .setFrontSize(.4)
        .setNumbersFrom(1)
        .setNumbersTo(9)
        .setRingSizes([1., .9, .8, .7, .6, .5, .4, .3, .2, .1, .05])
        .getTarget();

},{"../RingTargetBuilder":18}],20:[function(require,module,exports){
module.exports = require('./DFSTenRingTarget');

},{"./DFSTenRingTarget":19}],21:[function(require,module,exports){
var RingTargetBuilder = require('../RingTargetBuilder');

module.exports = new RingTargetBuilder()
        .setFrontSize(.4578)
        .setNumbersFrom(1)
        .setNumbersTo(8)
        .setRingSizes([1., .8916, .7831, .6747, .5663, .4578, .3494, .2410, .1325, .0241])
        .getTarget();

},{"../RingTargetBuilder":18}],22:[function(require,module,exports){
module.exports=require(20)
},{"./DFSTenRingTarget":19}],23:[function(require,module,exports){
module.exports=require(20)
},{"./DFSTenRingTarget":19}],24:[function(require,module,exports){
var RingTargetScaler = require('../scaler/RingTargetScaler');
var RingTargetRenderer = require('../renderer/RingTargetRenderer');

var targets =  {
    'NO_DFS_100M':require('./dfs/NO_DFS_100M'),
    'NO_DFS_200M':require('./dfs/NO_DFS_200M'),
    'NO_DFS_300M':require('./dfs/NO_DFS_300M'),
    'NO_DFS_15M':require('./dfs/NO_DFS_15M')
};

function getTarget(targetID) {
    return targets[targetID];
}

function getScaler(targetID) {
    switch (targetID) {
        case 'NO_DFS_100M':
        case 'NO_DFS_200M':
        case 'NO_DFS_300M':
        case 'NO_DFS_15M':
            return new RingTargetScaler()
                .setTarget(getTarget(targetID));
    }
}

function getRenderer(targetID) {
    switch (targetID) {
        case 'NO_DFS_100M':
        case 'NO_DFS_200M':
        case 'NO_DFS_300M':
        case 'NO_DFS_15M':
            return new RingTargetRenderer()
                .setTarget(getTarget(targetID));
    }
}

module.exports = {
    getTarget:getTarget,
    getScaler:getScaler,
    getRenderer:getRenderer
};

for (var targetID in targets) {
    module.exports[targetID] = targets[targetID];
}

},{"../renderer/RingTargetRenderer":12,"../scaler/RingTargetScaler":16,"./dfs/NO_DFS_100M":20,"./dfs/NO_DFS_15M":21,"./dfs/NO_DFS_200M":22,"./dfs/NO_DFS_300M":23}],25:[function(require,module,exports){
function CanvasView() {
    this.initialize();
}

module.exports = CanvasView;

// --- Internal API ---
CanvasView.prototype.initialize = function () {
    this.canvas = document.createElement('canvas');
};

CanvasView.prototype.draw = function () {
    var rect = {
        x:0,
        y:0,
        width:this.canvas.width,
        height:this.canvas.height
    };

    var ctx = this.getContext();

    ctx.clearRect(rect.x, rect.y, rect.width, rect.height);
    this.render(ctx, rect);
};

CanvasView.prototype.render = function (ctx, rect) {
    // to be overloaded
};

CanvasView.prototype.getContext = function () {
    try {
        G_vmlCanvasManager.initElement(this.canvas);
    } catch (err) {};

    return this.canvas.getContext('2d');
};

},{}],26:[function(require,module,exports){
var inherits = require('inherits');
var LiveShot = require('liveshot-core');
var CanvasView = require('./CanvasView');
var CardBuilder = require('liveshot-protocol').CardBuilder;

function CardView() {
    this.initialize();
}

module.exports = CardView;
inherits(CardView, CanvasView);

// --- External API ---
CardView.prototype.setCard = function (card, valid) {
    if (!valid) {
        card = CardBuilder.sanitizeCard(card);
    }

    this.card = card;

    this.setTarget(this.card.config.targetID);
    this.setGaugeSize(this.card.config.gaugeSize);
    this.setShots(this.card.result.shots);

    this.updateScale();
    this.draw();
};

// --- Internal API ---
CardView.prototype.initialize = function () {
    CanvasView.prototype.initialize.apply(this);

    this.card = CardBuilder.createBlankCard();
    this.shotRenderer = new LiveShot.ShotRenderer();
    this.triangleRenderer = new LiveShot.TriangleRenderer();
};

CardView.prototype.setTarget = function (targetID) {
    if (this.targetID == targetID) {
        return;
    }

    this.targetID = targetID;

    this.targetRenderer = LiveShot.targets.getRenderer(this.targetID);
    this.scaler = LiveShot.targets.getScaler(this.targetID);
};

CardView.prototype.setShots = function (shots) {
    if (this.shots == shots) {
        return;
    }

    this.shots = shots;

    this.scaler.setShots(shots);
    this.shotRenderer.setShots(shots);
};

CardView.prototype.setGaugeSize = function (gaugeSize) {
    if (this.gaugeSize == gaugeSize) {
        return;
    }

    this.gaugeSize = gaugeSize;
    this.shotRenderer.setStyle({gaugeSize:gaugeSize});
};

CardView.prototype.updateScale = function () {
    var scale = this.scaler.getScale();

    this.targetRenderer.setScale(scale);
    this.shotRenderer.setScale(scale);
};

CardView.prototype.render = function (ctx, rect) {
    this.renderTarget(ctx, rect);
};

CardView.prototype.renderTarget = function (ctx, rect) {
    if (this.targetRenderer == null) {
        return;
    }

    var targetRect = this.getTargetRect(rect);

    this.targetRenderer
        .setContext(ctx)
        .setRect(targetRect)
        .render();

    this.shotRenderer
        .setContext(ctx)
        .setRect(targetRect)
        .render();

    if (!this.card.result.marking) {
        this.triangleRenderer
            .setContext(ctx)
            .setRect(targetRect)
            .render();
    }
};

CardView.prototype.getTargetRect = function (rect) {
    return rect;
};

},{"./CanvasView":25,"inherits":8,"liveshot-core":10,"liveshot-protocol":29}],27:[function(require,module,exports){
var inherits = require('inherits');
var LiveShot = require('liveshot-core');
var CardView = require('../CardView');

// --- Constants ---
var MARGINH = 5;
var MARGINV = 3;

function MegalinkCardView() {
    this.initialize();
}

module.exports = MegalinkCardView;
inherits(MegalinkCardView, CardView);

// --- Internal API ---
MegalinkCardView.prototype.initialize = function () {
    CardView.prototype.initialize.apply(this);

    this.style = {
        backgroundColor:'rgb(255, 255, 255)',
        fontColor:'rgb(0, 0, 0)'
    };

    this.canvas = document.createElement('canvas');

    this.shotRenderer = new LiveShot.ShotRenderer();
    this.shotRenderer.setStyle({
        gaugeColor:'rgb(0, 0, 0)',
        markerColor:'rgb(0, 255, 0)',
        lastMarkerColor:'rgb(255, 0, 0)'
    });

    this.triangleRenderer.setStyle({
        color:'rgb(248, 255, 0)',
        borderColor:'rgb(0, 0, 0)',
    });
};

MegalinkCardView.prototype.setTarget = function (targetID) {
    if (this.targetID == targetID) {
        return;
    }

    this.targetID = targetID;

    this.targetRenderer = LiveShot.targets.getRenderer(this.targetID);
    this.targetRenderer.setStyle({
        drawFullTarget:true
    });
    this.scaler = LiveShot.targets.getScaler(this.targetID);
};

MegalinkCardView.prototype.setShots = function (shots) {
    if (this.shots == shots) {
        return;
    }

    this.shots = shots;

    this.scaler.setShots(shots);
    this.shotRenderer.setShots(shots);
};

MegalinkCardView.prototype.setGaugeSize = function (gaugeSize) {
    if (this.gaugeSize == gaugeSize) {
        return;
    }

    this.gaugeSize = gaugeSize;
    this.shotRenderer.setStyle({gaugeSize:gaugeSize});
};

MegalinkCardView.prototype.updateScale = function () {
    var scale = this.scaler.getScale();

    this.targetRenderer.setScale(scale);
    this.shotRenderer.setScale(scale);
};

MegalinkCardView.prototype.render = function (ctx, rect) {
    this.renderTarget(ctx, rect);
    this.renderHeader(ctx, rect);
    this.renderShotList(ctx, rect);
    this.renderSums(ctx, rect);
};

MegalinkCardView.prototype.renderTarget = function (ctx, rect) {
    CardView.prototype.renderTarget.apply(this, [ctx, rect]);

    this.strokeFrame(ctx, MegalinkCardView.getTargetRect(rect));
};

MegalinkCardView.prototype.renderHeader = function (ctx, rect) {
    this.drawFrame(ctx, MegalinkCardView.getHeaderRect(rect));

    this.renderName(ctx, MegalinkCardView.getNameRect(rect));
    this.renderClub(ctx, MegalinkCardView.getClubRect(rect));
    this.renderSeriesName(ctx, MegalinkCardView.getSeriesNameRect(rect));
    this.renderClass(ctx, MegalinkCardView.getClassRect(rect));
    this.renderCategory(ctx, MegalinkCardView.getCategoryRect(rect));
};

MegalinkCardView.prototype.renderName = function (ctx, rect) {
    var name = this.card.shooter.name;

    this.setFont(ctx, name, rect.width, rect.height);
    ctx.textBaseline = "top";
    ctx.textAlign = "left";

    ctx.fillStyle = this.style.fontColor;
    ctx.fillText(name, rect.x, rect.y);
};

MegalinkCardView.prototype.renderClub = function (ctx, rect) {
    var club = this.card.shooter.club;

    this.setFont(ctx, club, rect.width, rect.height);
    ctx.textBaseline = "bottom";
    ctx.textAlign = "left";

    ctx.fillStyle = this.style.fontColor;
    ctx.fillText(club, rect.x, rect.y + rect.height);
};

MegalinkCardView.prototype.renderSeriesName = function (ctx, rect) {
    var seriesName = this.card.result.seriesName;

    this.setFont(ctx, seriesName, rect.width, rect.height);
    ctx.textBaseline = "bottom";
    ctx.textAlign = "left";

    ctx.fillStyle = this.style.fontColor;
    ctx.fillText(seriesName, rect.x, rect.y + rect.height);
};

MegalinkCardView.prototype.renderClass = function (ctx, rect) {
    var className = this.card.shooter.className;

    this.setFont(ctx, className, rect.width, rect.height);
    ctx.textBaseline = "bottom";
    ctx.textAlign = "right";

    ctx.fillStyle = this.style.fontColor;
    ctx.fillText(className, rect.x + rect.width, rect.y + rect.height);
};

MegalinkCardView.prototype.renderCategory = function (ctx, rect) {
    var category = this.card.shooter.category;

    this.setFont(ctx, category, rect.width, rect.height);
    ctx.textBaseline = "bottom";
    ctx.textAlign = "right";

    ctx.fillStyle = this.style.fontColor;
    ctx.fillText(category, rect.x + rect.width, rect.y + rect.height);
};

MegalinkCardView.prototype.renderShotList = function (ctx, rect) {
    this.drawFrame(ctx, MegalinkCardView.getShotListRect(rect));

    this.renderList(ctx, rect);
    this.renderShots(ctx, rect);
};

MegalinkCardView.prototype.renderList = function (ctx, rect) {
    var rect = MegalinkCardView.getShotListRect(rect);

    var numRows = this.getNumRows();
    var numColumns = this.getNumColumns();
    var rowHeight = rect.height / numRows;
    var columnWidth = rect.width / numColumns;

    ctx.strokeStyle = this.style.fontColor;
    ctx.beginPath();

    for (var i = 1; i < numRows; ++i) {
        var y = rect.y + i*rowHeight;

        ctx.moveTo(rect.x, y);
        ctx.lineTo(rect.x + rect.width, y);
    }

    for (var i = 1; i < numColumns; ++i) {
        var x = rect.x + i*columnWidth;

        ctx.moveTo(x, rect.y);
        ctx.lineTo(x, rect.y + rect.height);
    }

    ctx.stroke();
    ctx.closePath();
};

MegalinkCardView.prototype.renderShots = function (ctx, rect) {
    var shots = this.card.result.shots;

    var shotNum = 1;
    for (var idx in shots) {
        var shot = shots[idx];
        var shotRect = this.getShotRect(shotNum, rect);

        this.renderShot(ctx, shotNum, shot, shotRect);

        ++shotNum;
    }
};

MegalinkCardView.prototype.renderShot = function (ctx, shotNum, shot, rect) {
    this.setFont(ctx, '', rect.width, .9*rect.height);
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = this.style.fontColor;

    // draw shot number
    ctx.textAlign = 'right';
    ctx.fillText(shotNum + ':', rect.x + .3*rect.width, rect.y);

    // draw shot value
    ctx.textAlign = 'right';
    ctx.fillText(shot.value, rect.x + rect.width - 5, rect.y);
};

MegalinkCardView.prototype.getShotRect = function (shotNum, rect) {
    var numRows = this.getNumRows();
    var numColumns = this.getNumColumns();
    var rect = MegalinkCardView.getShotListRect(rect);

    var cellWidth = rect.width / numColumns;
    var cellHeight = rect.height / numRows;

    var j = Math.floor((shotNum - 1) / numRows);
    var i = shotNum - j*numRows;

    return {
        x:rect.x + j*cellWidth,
        y:rect.y + i*cellHeight,
        width:cellWidth,
        height:cellHeight
    };
};

MegalinkCardView.prototype.getNumRows = function () {
    return 5; // XXX set as style property?
};

MegalinkCardView.prototype.getNumColumns = function () {
    var numShots = 0;
    for (var idx in this.card.result.shots) ++numShots;

    return Math.min(2, Math.ceil(numShots / this.getNumRows()));
};

MegalinkCardView.prototype.renderSums = function (ctx, rect) {
    var rect = MegalinkCardView.getSumsRect(rect);

    this.drawFrame(ctx, rect);

    ctx.fillStyle = this.style.fontColor;
    ctx.fillRect(rect.x + .5*rect.width, rect.y, .5*rect.width, rect.height);

    // draw text
    var seriesSum = this.card.result.seriesSum;
    var totalSum = this.card.result.totalSum;

    this.setFont(ctx, totalSum, .6*rect.width, .6*rect.height);
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";

    ctx.fillStyle = this.style.fontColor;
    ctx.fillText(seriesSum, rect.x + .25*rect.width, rect.y + .5*rect.height);

    ctx.fillStyle = this.style.backgroundColor;
    ctx.fillText(totalSum, rect.x + .75*rect.width, rect.y + .5*rect.height);
};

// --- Rendering utilities ---
MegalinkCardView.prototype.strokeFrame = function (ctx, rect) {
    ctx.strokeStyle = this.style.fontColor;
    ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
};

MegalinkCardView.prototype.drawFrame = function (ctx, rect) {
    ctx.fillStyle = this.style.backgroundColor;
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);

    this.strokeFrame(ctx, rect);
};

MegalinkCardView.prototype.setFont = function (ctx, text, width, height) {
    var fontName = "arial";
    var refSize = 10;

    // get reference text width
    ctx.font = refSize + "px " + fontName;
    var refTextWidth = ctx.measureText(text).width;

    // calculate maximum textHeight
    var textHeight = Math.min(height, width/refTextWidth * refSize);

    // assemble font name
    ctx.font = textHeight + "px " + fontName;
};

// --- Rect stuff ---
MegalinkCardView.isPortrait = function (rect) {
    return rect.width / rect.height < 1;
};

MegalinkCardView.prototype.getTargetRect = function (rect) {
    return MegalinkCardView.getTargetRect(rect);
};

MegalinkCardView.getTargetRect = function (rect) {
    if (MegalinkCardView.isPortrait(rect)) {
        return {
            x:rect.x,
            y:rect.y + .125*rect.height,
            width:rect.width,
            height:.5*rect.height
        }
    } else {
        return {
            x:rect.x,
            y:rect.y + .25*rect.height,
            width:.6*rect.width,
            height:.75*rect.height
        };
    }
};

MegalinkCardView.getHeaderRect = function (rect) {
    if (MegalinkCardView.isPortrait(rect)) {
        return {
            x:rect.x,
            y:rect.y,
            width:rect.width,
            height:.125*rect.height
        };
    } else {
        return {
            x:rect.x,
            y:rect.y,
            width:rect.width,
            height:.25*rect.height
        };
    }
};

MegalinkCardView.getNameRect = function (rect) {
    var rect = MegalinkCardView.getHeaderRect(rect);

    var width = rect.width;
    var height = .55*rect.height;

    return {
        x:rect.x + MARGINH,
        y:rect.y + MARGINV,
        width:width - 2*MARGINH,
        height:height - 2*MARGINV
    };
};

MegalinkCardView.getClubRect = function (rect) {
    var rect = MegalinkCardView.getHeaderRect(rect);

    var width = .55*rect.width;
    var height = .45*rect.height;

    return {
        x:rect.x + MARGINH,
        y:rect.y + rect.height - height + MARGINV,
        width:width - 3/2*MARGINH,
        height:height - 2*MARGINV
    };
};

MegalinkCardView.getSeriesNameRect = function (rect) {
    var rect = MegalinkCardView.getHeaderRect(rect);

    var width = .25*rect.width;
    var height = .45*rect.height;

    return {
        x:rect.x + .55*rect.width + MARGINH/2,
        y:rect.y + rect.height - height + MARGINV,
        width:width - MARGINH,
        height:height - 2*MARGINV
    };
};

MegalinkCardView.getClassRect = function (rect) {
    var rect = MegalinkCardView.getHeaderRect(rect);

    var width = .13*rect.width;
    var height = .45*rect.height;

    return {
        x:rect.x + .8*rect.width + MARGINH/2,
        y:rect.y + rect.height - height + MARGINV,
        width:width - MARGINH,
        height:height - 2*MARGINV
    };
};

MegalinkCardView.getCategoryRect = function (rect) {
    var rect = MegalinkCardView.getHeaderRect(rect);

    var width = .07*rect.width;
    var height = .45*rect.height;

    return {
        x:rect.x + .93*rect.width + MARGINH/2,
        y:rect.y + rect.height - height + MARGINV,
        width:width - 3/2*MARGINH,
        height:height - 2*MARGINV
    };
};

MegalinkCardView.getShotListRect = function (rect) {
    if (MegalinkCardView.isPortrait(rect)) {
        return {
            x:rect.x,
            y:rect.y + .625*rect.height,
            width:rect.width,
            height:.25*rect.height
        };
    } else {
        return {
            x:rect.x + .6*rect.width,
            y:rect.y + .25*rect.height,
            width:.4*rect.width,
            height:.55*rect.height
        };
    }
};

MegalinkCardView.getSumsRect = function (rect) {
    if (MegalinkCardView.isPortrait(rect)) {
        return {
            x:rect.x,
            y:rect.y + .875*rect.height,
            width:rect.width,
            height:.125*rect.height
        };
    } else {
        return {
            x:rect.x + .6*rect.width,
            y:rect.y + .80*rect.height,
            width:.4*rect.width,
            height:.20*rect.height
        };
    }
};

},{"../CardView":26,"inherits":8,"liveshot-core":10}],28:[function(require,module,exports){
var MegalinkCardView = require('./MegalinkCardView');
var RangeBuilder = require('liveshot-protocol').RangeBuilder;

function MegalinkRangeView() {
    this.initialize();
}

module.exports = MegalinkRangeView;

// --- External API ---
MegalinkRangeView.prototype.setRange = function (range, valid) {
    if (!valid) {
        range = RangeBuilder.sanitizeRange(range);
    }

    this.range = range;

    var numCards = objectSize(range.cards);

    while (this.cardViews.length < numCards) {
        var cardView = new MegalinkCardView();
        cardView.canvas.style.marginBottom = '-4px';
        this.el.appendChild(cardView.canvas);

        this.cardViews.push(cardView);
    }

    while (this.cardViews.length > numCards) {
        var cardView = this.cardViews.pop();
        this.el.removeChild(cardView.canvas);
    }

    var i = 0;
    for (var idx in range.cards) {
        var card = range.cards[idx];
        var cardView = this.cardViews[i++];

        cardView.setCard(card, true);
    }

    this.updateSize();
    this.draw();
};

// --- Internal API ---
MegalinkRangeView.HEADER_HEIGHT = 90;
MegalinkRangeView.HEADER_MARGIN = 8;
MegalinkRangeView.HEADER_FONT_COLOR = 'rgb(0, 0, 0)';

MegalinkRangeView.prototype.initialize = function () {
    this.el = document.createElement('div');

    this.header = document.createElement('canvas');
    this.el.appendChild(this.header);

    this.el.onclick = function () {
        toggleFullscreen();

        return false;
    };

    this.cardViews = [];
};

MegalinkRangeView.prototype.draw = function () {
    if (this.range) {
        this.drawHeader();
    }

    for (var idx in this.cardViews) {
        var cardView = this.cardViews[idx];

        cardView.draw();
    }
};

MegalinkRangeView.prototype.drawHeader = function () {
    var ctx = this.getHeaderContext();
    var rect = {
        x:0,
        y:0,
        width:this.header.width,
        height:this.header.height
    };

    ctx.clearRect(rect.x, rect.y, rect.width, rect.height);

    this.renderHeader(ctx, rect);
};

MegalinkRangeView.prototype.renderHeader = function (ctx, rect) {
    this.renderHost(ctx, rect);
    this.renderRangeRelay(ctx, rect);
    this.renderLogo(ctx, rect);
};

MegalinkRangeView.prototype.renderHost = function (ctx, rect) {
    var hostRect = MegalinkRangeView.getHostRect(rect);
    var host = this.range.host;

    ctx.fillStyle = MegalinkRangeView.HEADER_FONT_COLOR;
    this.setFont(ctx, host, hostRect.width, hostRect.height);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(host, hostRect.x + hostRect.width/2, hostRect.y + hostRect.height/2);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
};

MegalinkRangeView.prototype.renderRangeRelay = function (ctx, rect) {
    var rangeRelay = this.range.name + ' - Lag nr ' + this.range.relay;
    var rangeRelayRect = MegalinkRangeView.getRangeRelayRect(rect);

    ctx.fillStyle = MegalinkRangeView.HEADER_FONT_COLOR;
    this.setFont(ctx, rangeRelay, rangeRelayRect.width, rangeRelayRect.height);

    ctx.textBaseline = 'middle';
    ctx.fillText(rangeRelay, rangeRelayRect.x, rangeRelayRect.y + rangeRelayRect.height/2);
    ctx.textBaseline = 'alphabetic';
};

MegalinkRangeView.prototype.renderLogo = function (ctx, rect) {
    if (!this.logo || this.logo.width == 0) {
        this.logo = new Image();
        this.logo.src = 'images/mllogo.png';

        var self = this;
        this.logo.onload = function () {
            self.renderLogo(ctx, rect);
        };

        return;
    }

    var maxRect = MegalinkRangeView.getLogoMaxRect(rect);

    var width = this.logo.width;
    var height = this.logo.height;
    var logoTooLarge = width > maxRect.width || height > maxRect.height;

    if (logoTooLarge) {
        var ratio = width / height;

        if (width - maxRect.width > height - maxRect.height) {
            width = maxRect.width;
            height = maxRect.width / ratio;
        } else {
            width = maxRect.height * ratio;
            height = maxRect.height;
        }
    }

    var left = rect.x + rect.width - MegalinkRangeView.HEADER_MARGIN - width;
    var top = rect.y + rect.height/2 - height/2;

    ctx.drawImage(this.logo, left, top, width, height);
};

MegalinkRangeView.prototype.updateSize = function () {
    var width = this.el.clientWidth;
    var height = this.el.clientHeight - MegalinkRangeView.HEADER_HEIGHT;

    this.header.width = width;
    this.header.height = MegalinkRangeView.HEADER_HEIGHT;

    var N = this.cardViews.length;
    var minBadness = Number.MAX_VALUE;
    var bestM = 0;
    var bestN = 0;

    for (var m = 1; m <= N; ++m) {
        var n = Math.ceil(N / m);
        var cardWidth = width/n;
        var cardHeight = height/m;
        var targetRect = MegalinkCardView.getTargetRect({x:0, y:0, width:cardWidth, height:cardHeight});

        var aspectRatio = targetRect.width / targetRect.height;
        var optimalRatio = 1;
        var ratioBadness =  Math.abs(aspectRatio - optimalRatio) + Math.abs(1/aspectRatio - 1/optimalRatio);
        var cellCountBadness = Math.abs(n*m - N);
        var badness = ratioBadness + cellCountBadness;

        if (badness < minBadness) {
            minBadness = badness;
            bestM = m;
            bestN = n;
        }
    }

    var m = bestM;
    var n = bestN;

    var cardWidth = width/n;
    var cardHeight = height/m;

    for (var i = 0; i < m; ++i) {
        for (var j = 0; j < n; ++j) {
            var cardViewIdx = i*n + j;
            if (cardViewIdx >= this.cardViews.length) {
                break;
            }

            var cardView = this.cardViews[cardViewIdx];

            var leftEdge = Math.floor(j*cardWidth);
            var rightEdge = Math.floor((j + 1)*cardWidth);
            cardView.canvas.width = rightEdge - leftEdge;
            cardView.canvas.style.width = cardView.canvas.width + 'px';

            var topEdge = Math.floor(i*cardHeight);
            var bottomEdge = Math.floor((i + 1)*cardHeight);
            cardView.canvas.height = bottomEdge - topEdge;
            cardView.canvas.style.height = cardView.canvas.height + 'px';
        }
    }
};

MegalinkRangeView.prototype.setFont = function (ctx, text, width, height) {
    var fontName = "arial";
    var refSize = 10;

    // get reference text width
    ctx.font = refSize + "px " + fontName;
    var refTextWidth = ctx.measureText(text).width;

    // calculate maximum textHeight
    var textHeight = Math.min(height, width/refTextWidth * refSize);

    // assemble font name
    ctx.font = textHeight + "px " + fontName;
};

MegalinkRangeView.getRangeRelayRect = function (rect) {
    return {
        x:rect.x + 3*MegalinkRangeView.HEADER_MARGIN,
        y:rect.y + MegalinkRangeView.HEADER_MARGIN,
        width:rect.width/5,
        height:rect.height - 2*MegalinkRangeView.HEADER_MARGIN
    };
};

MegalinkRangeView.getHostRect = function (rect) {
    return {
        x:rect.x + rect.width/4 + 2*MegalinkRangeView.HEADER_MARGIN,
        y:rect.y + 2*MegalinkRangeView.HEADER_MARGIN,
        width:rect.width/2 - 4*MegalinkRangeView.HEADER_MARGIN,
        height:rect.height - 4*MegalinkRangeView.HEADER_MARGIN
    };
};

MegalinkRangeView.getLogoMaxRect = function (rect) {
    return {
        x:rect.x + 5*rect.width/8,
        y:rect.y + MegalinkRangeView.HEADER_MARGIN,
        width:rect.width/4,
        height:rect.height - 2*MegalinkRangeView.HEADER_MARGIN
    };
};

// --- Canvas context handling ---
MegalinkRangeView.prototype.getHeaderContext = function () {
    try {
        G_vmlCanvasManager.initElement(this.header);
    } catch (err) {};

    return this.header.getContext('2d');
};

// --- Fullscreen handling ---
function toggleFullscreen() {
    if (isFullscreen()) {
        exitFullscreen();
    } else {
        requestFullscreen();
    }

}

function fullscreenAvailable() {
    var docElm = document.documentElement;
    return (docElm.requestFullscreen || docElm.requestFullScreen ||
            docElm.mozRequestFullScreen || docElm.webkitRequestFullScreen);
}

function isFullscreen() {
    return (document.fullscreen || document.fullScreen ||
            document.mozFullScreen || document.webkitIsFullScreen);
}

function requestFullscreen() {
    var docElm = document.documentElement;
    if (docElm.requestFullScreen) {
        docElm.requestFullScreen();
    } else if (docElm.mozRequestFullScreen) {
        docElm.mozRequestFullScreen();
    } else if (docElm.webkitRequestFullScreen) {
        docElm.webkitRequestFullScreen();
    } else if (docElm.requestFullscreen) {
        docElm.requestFullscreen();
    }
}

function exitFullscreen() {
    if (document.exitFullscreen) {
        document.exitFullscreen();
    } else if (document.mozCancelFullScreen) {
        document.mozCancelFullScreen();
    } else if (document.webkitCancelFullScreen) {
        document.webkitCancelFullScreen();
    } else if (document.cancelFullscreen) {
        document.cancelFullscreen();
    }
}

function objectSize(object) {
    var size = 0;

    for (var key in object) {
        ++size;
    }

    return size;
};

},{"./MegalinkCardView":27,"liveshot-protocol":29}],29:[function(require,module,exports){
module.exports = {
    Builder:require('./src/Builder'),
    CardBuilder:require('./src/CardBuilder'),
    ConfigBuilder:require('./src/ConfigBuilder'),
    RangeBuilder:require('./src/RangeBuilder'),
    ResultBuilder:require('./src/ResultBuilder'),
    ShooterBuilder:require('./src/ShooterBuilder'),
    ShotBuilder:require('./src/ShotBuilder')
};

},{"./src/Builder":30,"./src/CardBuilder":31,"./src/ConfigBuilder":32,"./src/RangeBuilder":33,"./src/ResultBuilder":34,"./src/ShooterBuilder":35,"./src/ShotBuilder":36}],30:[function(require,module,exports){
function Builder() {
    this.reset();
}

module.exports = Builder;

// --- Static methods ---
Builder.blankCopy = function (defaultObject) {
    return cloneDeep(defaultObject);
};

Builder.sanitize = function (rawObject, defaultObject) {
    return set(rawObject, this.blankCopy(defaultObject));
};

// --- Non-static methods ---
Builder._default = {};

Builder.prototype.reset = function () {
    this._object = Builder.blankCopy(this.constructor._default);

    return this;
};

Builder.prototype.getObject = function () {
    return cloneDeep(this._object);
};

Builder.prototype.setObject = function (rawObject) {
    this._object = Builder.sanitize(rawObject, this.constructor._default);

    return this;
};

// --- Internal helpers ---
/** Copies all existing fields in 'to' from 'from' */
function set(from, to) {
    for (var key in to) {
        if (!from.hasOwnProperty(key)) {
            continue;
        }

        var value = from[key];

        if (value instanceof Array) {
            to[key] = [].concat(value);
        } else {
            to[key] = value;
        }
    }

    return to;
}

function clone(object) {
    var copy = {};

    for (var key in object) {
        var value = object[key];

        if (value instanceof Array) {
            copy[key] = [].concat(value);
        } else {
            copy[key] = value;
        }
    }

    return copy;
}

function cloneDeep(object) {
    if (!(object instanceof Object)) {
        return object;
    }

    var copy = {};

    for (var key in object) {
        var value = object[key];

        if (value instanceof Array) {
            copy[key] = [];

            for (var idx in value) {
                copy[key].push(cloneDeep(value[idx]));
            }
        } else {
            copy[key] = cloneDeep(value);
        }
    }

    return copy;
}

},{}],31:[function(require,module,exports){
var Builder = require('./Builder');
var inherits = require('inherits');
var ConfigBuilder = require('./ConfigBuilder');
var ResultBuilder = require('./ResultBuilder');
var ShooterBuilder = require('./ShooterBuilder');

function CardBuilder() {
    this.initialize();
    this.reset();
}

module.exports = CardBuilder;
inherits(CardBuilder, Builder);

CardBuilder._default = {
    lane:'',
    shooter:ShooterBuilder.createBlankShooter(),
    result:ResultBuilder.createBlankResult(),
    config:ConfigBuilder.createBlankConfig()
};

// --- External API ---
CardBuilder.createBlankCard = function () {
    return Builder.blankCopy(this._default);
};

CardBuilder.sanitizeCard = function (rawCard) {
    var card = Builder.sanitize(rawCard, this._default);

    card.shooter = ShooterBuilder.sanitizeShooter(card.shooter);
    card.result = ResultBuilder.sanitizeResult(card.result);
    card.config = ConfigBuilder.sanitizeConfig(card.config);

    return card;
};

CardBuilder.prototype.reset = function () {
    Builder.prototype.reset.apply(this);

    this._object.shooter = this._shooterBuilder.reset().getShooter();
    this._object.result = this._resultBuilder.reset().getResult();
    this._object.config = this._configBuilder.reset().getConfig();

    return this;
};

CardBuilder.prototype.getCard = function () {
    return this.getObject();
};

// --- Bulk setters ---
CardBuilder.prototype.setCard = function (card) {
    this.setObject(card);

    this.setConfig(card.config || {});
    this.setResult(card.result || {});
    this.setShooter(card.shooter || {});

    return this;
};

CardBuilder.prototype.setConfig = function (config) {
    this._object.config = this._configBuilder.setConfig(config).getConfig();

    return this;
};

CardBuilder.prototype.setResult = function (result) {
    this._object.result = this._resultBuilder.setResult(result).getResult();

    return this;
};

CardBuilder.prototype.setShooter = function (shooter) {
    this._object.shooter = this._shooterBuilder.setShooter(shooter).getShooter();

    return this;
};

// --- Fine grained setters ---
CardBuilder.prototype.setLane = function (lane) {
    this._object.lane = lane;

    return this;
};

CardBuilder.prototype.setName = function (name) {
    this._object.shooter = this._shooterBuilder.setName(name).getShooter();

    return this;
};

CardBuilder.prototype.setClub = function (club) {
    this._object.shooter = this._shooterBuilder.setClub(club).getShooter();

    return this;
};

CardBuilder.prototype.setClassName = function (className) {
    this._object.shooter = this._shooterBuilder.setClassName(className).getShooter();

    return this;
};

CardBuilder.prototype.setCategory = function (category) {
    this._object.shooter = this._shooterBuilder.setCategory(category).getShooter();

    return this;
};

CardBuilder.prototype.setSeriesName = function (seriesName) {
    this._object.result = this._resultBuilder.setSeriesName(seriesName).getResult();

    return this;
};

CardBuilder.prototype.setSeriesSum = function (seriesSum) {
    this._object.result = this._resultBuilder.setSeriesSum(seriesSum).getResult();

    return this;
};

CardBuilder.prototype.setTotalSum = function (totalSum) {
    this._object.result = this._resultBuilder.setTotalSum(totalSum).getResult();

    return this;
};

CardBuilder.prototype.setMarking = function (marking) {
    this._object.result = this._resultBuilder.setMarking(marking).getResult();

    return this;
};

CardBuilder.prototype.setGaugeSize = function (gaugeSize) {
    this._object.config = this._configBuilder.setGaugeSize(gaugeSize).getConfig();

    return this;
};

CardBuilder.prototype.setTargetID = function (targetID) {
    this._object.config = this._configBuilder.setTargetID(targetID).getConfig();

    return this;
};

CardBuilder.prototype.setShots = function (shots) {
    this._object.result = this._resultBuilder.setShots(shots).getResult();

    return this;
};

CardBuilder.prototype.resetShots = function () {
    this._object.result = this._resultBuilder.resetShots().getResult();

    return this;
};

CardBuilder.prototype.addShot = function (shot) {
    this._object.result = this._resultBuilder.addShot(shot).getResult();

    return this;
};

CardBuilder.prototype.addShotData = function (x, y, value) {
    this._object.result = this._resultBuilder.addShotData(x, y, value).getResult();

    return this;
};

// --- Internal API ---
CardBuilder.prototype.initialize = function () {
    this._shooterBuilder = new ShooterBuilder();
    this._resultBuilder = new ResultBuilder();
    this._configBuilder = new ConfigBuilder();
};

},{"./Builder":30,"./ConfigBuilder":32,"./ResultBuilder":34,"./ShooterBuilder":35,"inherits":8}],32:[function(require,module,exports){
var Builder = require('./Builder');
var inherits = require('inherits');

function ConfigBuilder() {
    this.reset();
}

module.exports = ConfigBuilder;
inherits(ConfigBuilder, Builder);

ConfigBuilder._default = {
    gaugeSize:.02,
    targetID:'NO_DFS_200M'
};

ConfigBuilder.createBlankConfig = function () {
    return Builder.blankCopy(this._default);
};

ConfigBuilder.sanitizeConfig = function (config) {
    return Builder.sanitize(config, this._default);
};

ConfigBuilder.prototype.getConfig = function () {
    return this.getObject();
};

ConfigBuilder.prototype.setConfig = function (config) {
    return this.setObject(config);
};

ConfigBuilder.prototype.setGaugeSize = function (gaugeSize) {
    this._object.gaugeSize = gaugeSize;

    return this;
};

ConfigBuilder.prototype.setTargetID = function (targetID) {
    this._object.targetID = targetID;

    return this;
};

},{"./Builder":30,"inherits":8}],33:[function(require,module,exports){
var Builder = require('./Builder');
var inherits = require('inherits');
var CardBuilder = require('./CardBuilder');

function RangeBuilder() {
    this.initialize();
    this.reset();
};

module.exports = RangeBuilder;
inherits(RangeBuilder, Builder);

RangeBuilder._default = {
    host:'',
    name:'',
    relay:'',
    cards:[]
};

// --- External API ---
RangeBuilder.createBlankRange = function () {
    return Builder.blankCopy(this._default);
};

RangeBuilder.sanitizeRange = function (rawRange) {
    var range = Builder.sanitize(rawRange, this._default);

    for (var key in range.cards) {
        range.cards[key] = CardBuilder.sanitizeCard(range.cards[key]);
    }

    return range;
};

RangeBuilder.prototype.resetCards = function () {
    this._object.cards = [];

    return this;
};

RangeBuilder.prototype.getRange = function () {
    return this.getObject();
};

RangeBuilder.prototype.setRange = function (range) {
    this.setObject(range);
    this.setCards(range.cards || []);

    return this;
};

// --- Fine grained setters ---
RangeBuilder.prototype.setHost = function (host) {
    this._object.host = host;

    return this;
};

RangeBuilder.prototype.setName = function (name) {
    this._object.name = name;

    return this;
};

RangeBuilder.prototype.setRelay = function (relay) {
    this._object.relay = relay;

    return this;
};

RangeBuilder.prototype.setCards = function (cards) {
    this.resetCards();

    for (var idx in cards) {
        this.addCard(CardBuilder.sanitizeCard(cards[idx]));
    }

    return this;
};

RangeBuilder.prototype.addCard = function (card) {
    card = this._cardBuilder.reset()
        .setCard(card)
        .getCard();
    this._object.cards.push(card);

    return this;
};

// --- Internal API ---
RangeBuilder.prototype.initialize = function () {
    this._cardBuilder = new CardBuilder();
};

},{"./Builder":30,"./CardBuilder":31,"inherits":8}],34:[function(require,module,exports){
var Builder = require('./Builder');
var ShotBuilder = require('./ShotBuilder');
var inherits = require('inherits');

function ResultBuilder() {
    this.initialize();
    this.reset();
}

module.exports = ResultBuilder;
inherits(ResultBuilder, Builder);

ResultBuilder._default = {
    seriesName:'',
    seriesSum:'',
    totalSum:'',
    marking:false,
    shots:[]
};

// --- External API ---
ResultBuilder.createBlankResult = function () {
    return Builder.blankCopy(this._default);
};

ResultBuilder.sanitizeResult = function (rawResult) {
    var result = Builder.sanitize(rawResult, this._default);

    for (var key in result.shots) {
        result.shots[key] = ShotBuilder.sanitizeShot(result.shots[key]);
    }

    return result;
};

ResultBuilder.prototype.resetShots = function () {
    this._object.shots = [];

    return this;
};

ResultBuilder.prototype.getResult = function () {
    return this.getObject();
};

ResultBuilder.prototype.setResult = function (result) {
    this.setObject(result);
    this.setShots(result.shots || []);

    return this;
};

ResultBuilder.prototype.setSeriesName = function (seriesName) {
    this._object.seriesName = seriesName;

    return this;
};

ResultBuilder.prototype.setSeriesSum = function (seriesSum) {
    this._object.seriesSum = seriesSum;

    return this;
};

ResultBuilder.prototype.setTotalSum = function (totalSum) {
    this._object.totalSum = totalSum;

    return this;
};

ResultBuilder.prototype.setMarking = function (marking) {
    this._object.marking = marking;

    return this;
};

ResultBuilder.prototype.setShots = function (shots) {
    this.resetShots();

    for (var idx in shots) {
        this.addShot(ShotBuilder.sanitizeShot(shots[idx]));
    }

    return this;
};

ResultBuilder.prototype.addShot = function (shot) {
    this._object.shots.push(shot);

    return this;
};

ResultBuilder.prototype.addShotData = function (x, y, value) {
    var shot = this._shotBuilder.reset()
        .setPosition(x, y)
        .setValue(value)
        .getShot();

    return this.addShot(shot);
};

// --- Internal API ---
ResultBuilder.prototype.initialize = function () {
    this._shotBuilder = new ShotBuilder();
};

},{"./Builder":30,"./ShotBuilder":36,"inherits":8}],35:[function(require,module,exports){
var Builder = require('./Builder');
var inherits = require('inherits');

function ShooterBuilder() {
    this.reset();
}

module.exports = ShooterBuilder;
inherits(ShooterBuilder, Builder);

ShooterBuilder._default = {
    name:'',
    club:'',
    className:'',
    category:''
};

ShooterBuilder.createBlankShooter = function () {
    return Builder.blankCopy(this._default);
};

ShooterBuilder.sanitizeShooter = function (shooter) {
    return Builder.sanitize(shooter, this._default);
};

ShooterBuilder.prototype.getShooter = function () {
    return this.getObject();
};

ShooterBuilder.prototype.setShooter = function (shooter) {
    return this.setObject(shooter);
};

ShooterBuilder.prototype.setName = function (name) {
    this._object.name = name;

    return this;
};

ShooterBuilder.prototype.setClub = function (club) {
    this._object.club = club;

    return this;
};

ShooterBuilder.prototype.setClassName = function (className) {
    this._object.className = className;

    return this;
};

ShooterBuilder.prototype.setCategory = function (category) {
    this._object.category = category;

    return this;
};

},{"./Builder":30,"inherits":8}],36:[function(require,module,exports){
var Builder = require('./Builder');
var inherits = require('inherits');

function ShotBuilder() {
    this.reset();
}

module.exports = ShotBuilder;
inherits(ShotBuilder, Builder);

ShotBuilder._default = {
    x:0,
    y:0,
    value:''
};

ShotBuilder.createBlankShot = function () {
    return Builder.blankCopy(this._default);
};

ShotBuilder.sanitizeShot = function (shot) {
    return Builder.sanitize(shot, this._default);
};

ShotBuilder.prototype.getShot = function () {
    return this.getObject();
};

ShotBuilder.prototype.setShot = function (shot) {
    return this.setObject(shot);
};

ShotBuilder.prototype.setPosition = function (x, y) {
    this.setX(x);
    this.setY(y);

    return this;
};

ShotBuilder.prototype.setX = function (x) {
    this._object.x = x;

    return this;
};

ShotBuilder.prototype.setY = function (y) {
    this._object.y = y;

    return this;
};

ShotBuilder.prototype.setValue = function (value) {
    this._object.value = value;

    return this;
};

},{"./Builder":30,"inherits":8}],37:[function(require,module,exports){


//
// The shims in this file are not fully implemented shims for the ES5
// features, but do work for the particular usecases there is in
// the other modules.
//

var toString = Object.prototype.toString;
var hasOwnProperty = Object.prototype.hasOwnProperty;

// Array.isArray is supported in IE9
function isArray(xs) {
  return toString.call(xs) === '[object Array]';
}
exports.isArray = typeof Array.isArray === 'function' ? Array.isArray : isArray;

// Array.prototype.indexOf is supported in IE9
exports.indexOf = function indexOf(xs, x) {
  if (xs.indexOf) return xs.indexOf(x);
  for (var i = 0; i < xs.length; i++) {
    if (x === xs[i]) return i;
  }
  return -1;
};

// Array.prototype.filter is supported in IE9
exports.filter = function filter(xs, fn) {
  if (xs.filter) return xs.filter(fn);
  var res = [];
  for (var i = 0; i < xs.length; i++) {
    if (fn(xs[i], i, xs)) res.push(xs[i]);
  }
  return res;
};

// Array.prototype.forEach is supported in IE9
exports.forEach = function forEach(xs, fn, self) {
  if (xs.forEach) return xs.forEach(fn, self);
  for (var i = 0; i < xs.length; i++) {
    fn.call(self, xs[i], i, xs);
  }
};

// Array.prototype.map is supported in IE9
exports.map = function map(xs, fn) {
  if (xs.map) return xs.map(fn);
  var out = new Array(xs.length);
  for (var i = 0; i < xs.length; i++) {
    out[i] = fn(xs[i], i, xs);
  }
  return out;
};

// Array.prototype.reduce is supported in IE9
exports.reduce = function reduce(array, callback, opt_initialValue) {
  if (array.reduce) return array.reduce(callback, opt_initialValue);
  var value, isValueSet = false;

  if (2 < arguments.length) {
    value = opt_initialValue;
    isValueSet = true;
  }
  for (var i = 0, l = array.length; l > i; ++i) {
    if (array.hasOwnProperty(i)) {
      if (isValueSet) {
        value = callback(value, array[i], i, array);
      }
      else {
        value = array[i];
        isValueSet = true;
      }
    }
  }

  return value;
};

// String.prototype.substr - negative index don't work in IE8
if ('ab'.substr(-1) !== 'b') {
  exports.substr = function (str, start, length) {
    // did we get a negative start, calculate how much it is from the beginning of the string
    if (start < 0) start = str.length + start;

    // call the original function
    return str.substr(start, length);
  };
} else {
  exports.substr = function (str, start, length) {
    return str.substr(start, length);
  };
}

// String.prototype.trim is supported in IE9
exports.trim = function (str) {
  if (str.trim) return str.trim();
  return str.replace(/^\s+|\s+$/g, '');
};

// Function.prototype.bind is supported in IE9
exports.bind = function () {
  var args = Array.prototype.slice.call(arguments);
  var fn = args.shift();
  if (fn.bind) return fn.bind.apply(fn, args);
  var self = args.shift();
  return function () {
    fn.apply(self, args.concat([Array.prototype.slice.call(arguments)]));
  };
};

// Object.create is supported in IE9
function create(prototype, properties) {
  var object;
  if (prototype === null) {
    object = { '__proto__' : null };
  }
  else {
    if (typeof prototype !== 'object') {
      throw new TypeError(
        'typeof prototype[' + (typeof prototype) + '] != \'object\''
      );
    }
    var Type = function () {};
    Type.prototype = prototype;
    object = new Type();
    object.__proto__ = prototype;
  }
  if (typeof properties !== 'undefined' && Object.defineProperties) {
    Object.defineProperties(object, properties);
  }
  return object;
}
exports.create = typeof Object.create === 'function' ? Object.create : create;

// Object.keys and Object.getOwnPropertyNames is supported in IE9 however
// they do show a description and number property on Error objects
function notObject(object) {
  return ((typeof object != "object" && typeof object != "function") || object === null);
}

function keysShim(object) {
  if (notObject(object)) {
    throw new TypeError("Object.keys called on a non-object");
  }

  var result = [];
  for (var name in object) {
    if (hasOwnProperty.call(object, name)) {
      result.push(name);
    }
  }
  return result;
}

// getOwnPropertyNames is almost the same as Object.keys one key feature
//  is that it returns hidden properties, since that can't be implemented,
//  this feature gets reduced so it just shows the length property on arrays
function propertyShim(object) {
  if (notObject(object)) {
    throw new TypeError("Object.getOwnPropertyNames called on a non-object");
  }

  var result = keysShim(object);
  if (exports.isArray(object) && exports.indexOf(object, 'length') === -1) {
    result.push('length');
  }
  return result;
}

var keys = typeof Object.keys === 'function' ? Object.keys : keysShim;
var getOwnPropertyNames = typeof Object.getOwnPropertyNames === 'function' ?
  Object.getOwnPropertyNames : propertyShim;

if (new Error().hasOwnProperty('description')) {
  var ERROR_PROPERTY_FILTER = function (obj, array) {
    if (toString.call(obj) === '[object Error]') {
      array = exports.filter(array, function (name) {
        return name !== 'description' && name !== 'number' && name !== 'message';
      });
    }
    return array;
  };

  exports.keys = function (object) {
    return ERROR_PROPERTY_FILTER(object, keys(object));
  };
  exports.getOwnPropertyNames = function (object) {
    return ERROR_PROPERTY_FILTER(object, getOwnPropertyNames(object));
  };
} else {
  exports.keys = keys;
  exports.getOwnPropertyNames = getOwnPropertyNames;
}

// Object.getOwnPropertyDescriptor - supported in IE8 but only on dom elements
function valueObject(value, key) {
  return { value: value[key] };
}

if (typeof Object.getOwnPropertyDescriptor === 'function') {
  try {
    Object.getOwnPropertyDescriptor({'a': 1}, 'a');
    exports.getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
  } catch (e) {
    // IE8 dom element issue - use a try catch and default to valueObject
    exports.getOwnPropertyDescriptor = function (value, key) {
      try {
        return Object.getOwnPropertyDescriptor(value, key);
      } catch (e) {
        return valueObject(value, key);
      }
    };
  }
} else {
  exports.getOwnPropertyDescriptor = valueObject;
}

},{}],38:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

var util = require('util');

function EventEmitter() {
  this._events = this._events || {};
  this._maxListeners = this._maxListeners || undefined;
}
module.exports = EventEmitter;

// Backwards-compat with node 0.10.x
EventEmitter.EventEmitter = EventEmitter;

EventEmitter.prototype._events = undefined;
EventEmitter.prototype._maxListeners = undefined;

// By default EventEmitters will print a warning if more than 10 listeners are
// added to it. This is a useful default which helps finding memory leaks.
EventEmitter.defaultMaxListeners = 10;

// Obviously not all Emitters should be limited to 10. This function allows
// that to be increased. Set to zero for unlimited.
EventEmitter.prototype.setMaxListeners = function(n) {
  if (!util.isNumber(n) || n < 0)
    throw TypeError('n must be a positive number');
  this._maxListeners = n;
  return this;
};

EventEmitter.prototype.emit = function(type) {
  var er, handler, len, args, i, listeners;

  if (!this._events)
    this._events = {};

  // If there is no 'error' event listener then throw.
  if (type === 'error') {
    if (!this._events.error ||
        (util.isObject(this._events.error) && !this._events.error.length)) {
      er = arguments[1];
      if (er instanceof Error) {
        throw er; // Unhandled 'error' event
      } else {
        throw TypeError('Uncaught, unspecified "error" event.');
      }
      return false;
    }
  }

  handler = this._events[type];

  if (util.isUndefined(handler))
    return false;

  if (util.isFunction(handler)) {
    switch (arguments.length) {
      // fast cases
      case 1:
        handler.call(this);
        break;
      case 2:
        handler.call(this, arguments[1]);
        break;
      case 3:
        handler.call(this, arguments[1], arguments[2]);
        break;
      // slower
      default:
        len = arguments.length;
        args = new Array(len - 1);
        for (i = 1; i < len; i++)
          args[i - 1] = arguments[i];
        handler.apply(this, args);
    }
  } else if (util.isObject(handler)) {
    len = arguments.length;
    args = new Array(len - 1);
    for (i = 1; i < len; i++)
      args[i - 1] = arguments[i];

    listeners = handler.slice();
    len = listeners.length;
    for (i = 0; i < len; i++)
      listeners[i].apply(this, args);
  }

  return true;
};

EventEmitter.prototype.addListener = function(type, listener) {
  var m;

  if (!util.isFunction(listener))
    throw TypeError('listener must be a function');

  if (!this._events)
    this._events = {};

  // To avoid recursion in the case that type === "newListener"! Before
  // adding it to the listeners, first emit "newListener".
  if (this._events.newListener)
    this.emit('newListener', type,
              util.isFunction(listener.listener) ?
              listener.listener : listener);

  if (!this._events[type])
    // Optimize the case of one listener. Don't need the extra array object.
    this._events[type] = listener;
  else if (util.isObject(this._events[type]))
    // If we've already got an array, just append.
    this._events[type].push(listener);
  else
    // Adding the second element, need to change to array.
    this._events[type] = [this._events[type], listener];

  // Check for listener leak
  if (util.isObject(this._events[type]) && !this._events[type].warned) {
    var m;
    if (!util.isUndefined(this._maxListeners)) {
      m = this._maxListeners;
    } else {
      m = EventEmitter.defaultMaxListeners;
    }

    if (m && m > 0 && this._events[type].length > m) {
      this._events[type].warned = true;
      console.error('(node) warning: possible EventEmitter memory ' +
                    'leak detected. %d listeners added. ' +
                    'Use emitter.setMaxListeners() to increase limit.',
                    this._events[type].length);
      console.trace();
    }
  }

  return this;
};

EventEmitter.prototype.on = EventEmitter.prototype.addListener;

EventEmitter.prototype.once = function(type, listener) {
  if (!util.isFunction(listener))
    throw TypeError('listener must be a function');

  function g() {
    this.removeListener(type, g);
    listener.apply(this, arguments);
  }

  g.listener = listener;
  this.on(type, g);

  return this;
};

// emits a 'removeListener' event iff the listener was removed
EventEmitter.prototype.removeListener = function(type, listener) {
  var list, position, length, i;

  if (!util.isFunction(listener))
    throw TypeError('listener must be a function');

  if (!this._events || !this._events[type])
    return this;

  list = this._events[type];
  length = list.length;
  position = -1;

  if (list === listener ||
      (util.isFunction(list.listener) && list.listener === listener)) {
    delete this._events[type];
    if (this._events.removeListener)
      this.emit('removeListener', type, listener);

  } else if (util.isObject(list)) {
    for (i = length; i-- > 0;) {
      if (list[i] === listener ||
          (list[i].listener && list[i].listener === listener)) {
        position = i;
        break;
      }
    }

    if (position < 0)
      return this;

    if (list.length === 1) {
      list.length = 0;
      delete this._events[type];
    } else {
      list.splice(position, 1);
    }

    if (this._events.removeListener)
      this.emit('removeListener', type, listener);
  }

  return this;
};

EventEmitter.prototype.removeAllListeners = function(type) {
  var key, listeners;

  if (!this._events)
    return this;

  // not listening for removeListener, no need to emit
  if (!this._events.removeListener) {
    if (arguments.length === 0)
      this._events = {};
    else if (this._events[type])
      delete this._events[type];
    return this;
  }

  // emit removeListener for all listeners on all events
  if (arguments.length === 0) {
    for (key in this._events) {
      if (key === 'removeListener') continue;
      this.removeAllListeners(key);
    }
    this.removeAllListeners('removeListener');
    this._events = {};
    return this;
  }

  listeners = this._events[type];

  if (util.isFunction(listeners)) {
    this.removeListener(type, listeners);
  } else {
    // LIFO order
    while (listeners.length)
      this.removeListener(type, listeners[listeners.length - 1]);
  }
  delete this._events[type];

  return this;
};

EventEmitter.prototype.listeners = function(type) {
  var ret;
  if (!this._events || !this._events[type])
    ret = [];
  else if (util.isFunction(this._events[type]))
    ret = [this._events[type]];
  else
    ret = this._events[type].slice();
  return ret;
};

EventEmitter.listenerCount = function(emitter, type) {
  var ret;
  if (!emitter._events || !emitter._events[type])
    ret = 0;
  else if (util.isFunction(emitter._events[type]))
    ret = 1;
  else
    ret = emitter._events[type].length;
  return ret;
};
},{"util":39}],39:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

var shims = require('_shims');

var formatRegExp = /%[sdj%]/g;
exports.format = function(f) {
  if (!isString(f)) {
    var objects = [];
    for (var i = 0; i < arguments.length; i++) {
      objects.push(inspect(arguments[i]));
    }
    return objects.join(' ');
  }

  var i = 1;
  var args = arguments;
  var len = args.length;
  var str = String(f).replace(formatRegExp, function(x) {
    if (x === '%%') return '%';
    if (i >= len) return x;
    switch (x) {
      case '%s': return String(args[i++]);
      case '%d': return Number(args[i++]);
      case '%j':
        try {
          return JSON.stringify(args[i++]);
        } catch (_) {
          return '[Circular]';
        }
      default:
        return x;
    }
  });
  for (var x = args[i]; i < len; x = args[++i]) {
    if (isNull(x) || !isObject(x)) {
      str += ' ' + x;
    } else {
      str += ' ' + inspect(x);
    }
  }
  return str;
};

/**
 * Echos the value of a value. Trys to print the value out
 * in the best way possible given the different types.
 *
 * @param {Object} obj The object to print out.
 * @param {Object} opts Optional options object that alters the output.
 */
/* legacy: obj, showHidden, depth, colors*/
function inspect(obj, opts) {
  // default options
  var ctx = {
    seen: [],
    stylize: stylizeNoColor
  };
  // legacy...
  if (arguments.length >= 3) ctx.depth = arguments[2];
  if (arguments.length >= 4) ctx.colors = arguments[3];
  if (isBoolean(opts)) {
    // legacy...
    ctx.showHidden = opts;
  } else if (opts) {
    // got an "options" object
    exports._extend(ctx, opts);
  }
  // set default options
  if (isUndefined(ctx.showHidden)) ctx.showHidden = false;
  if (isUndefined(ctx.depth)) ctx.depth = 2;
  if (isUndefined(ctx.colors)) ctx.colors = false;
  if (isUndefined(ctx.customInspect)) ctx.customInspect = true;
  if (ctx.colors) ctx.stylize = stylizeWithColor;
  return formatValue(ctx, obj, ctx.depth);
}
exports.inspect = inspect;


// http://en.wikipedia.org/wiki/ANSI_escape_code#graphics
inspect.colors = {
  'bold' : [1, 22],
  'italic' : [3, 23],
  'underline' : [4, 24],
  'inverse' : [7, 27],
  'white' : [37, 39],
  'grey' : [90, 39],
  'black' : [30, 39],
  'blue' : [34, 39],
  'cyan' : [36, 39],
  'green' : [32, 39],
  'magenta' : [35, 39],
  'red' : [31, 39],
  'yellow' : [33, 39]
};

// Don't use 'blue' not visible on cmd.exe
inspect.styles = {
  'special': 'cyan',
  'number': 'yellow',
  'boolean': 'yellow',
  'undefined': 'grey',
  'null': 'bold',
  'string': 'green',
  'date': 'magenta',
  // "name": intentionally not styling
  'regexp': 'red'
};


function stylizeWithColor(str, styleType) {
  var style = inspect.styles[styleType];

  if (style) {
    return '\u001b[' + inspect.colors[style][0] + 'm' + str +
           '\u001b[' + inspect.colors[style][1] + 'm';
  } else {
    return str;
  }
}


function stylizeNoColor(str, styleType) {
  return str;
}


function arrayToHash(array) {
  var hash = {};

  shims.forEach(array, function(val, idx) {
    hash[val] = true;
  });

  return hash;
}


function formatValue(ctx, value, recurseTimes) {
  // Provide a hook for user-specified inspect functions.
  // Check that value is an object with an inspect function on it
  if (ctx.customInspect &&
      value &&
      isFunction(value.inspect) &&
      // Filter out the util module, it's inspect function is special
      value.inspect !== exports.inspect &&
      // Also filter out any prototype objects using the circular check.
      !(value.constructor && value.constructor.prototype === value)) {
    var ret = value.inspect(recurseTimes);
    if (!isString(ret)) {
      ret = formatValue(ctx, ret, recurseTimes);
    }
    return ret;
  }

  // Primitive types cannot have properties
  var primitive = formatPrimitive(ctx, value);
  if (primitive) {
    return primitive;
  }

  // Look up the keys of the object.
  var keys = shims.keys(value);
  var visibleKeys = arrayToHash(keys);

  if (ctx.showHidden) {
    keys = shims.getOwnPropertyNames(value);
  }

  // Some type of object without properties can be shortcutted.
  if (keys.length === 0) {
    if (isFunction(value)) {
      var name = value.name ? ': ' + value.name : '';
      return ctx.stylize('[Function' + name + ']', 'special');
    }
    if (isRegExp(value)) {
      return ctx.stylize(RegExp.prototype.toString.call(value), 'regexp');
    }
    if (isDate(value)) {
      return ctx.stylize(Date.prototype.toString.call(value), 'date');
    }
    if (isError(value)) {
      return formatError(value);
    }
  }

  var base = '', array = false, braces = ['{', '}'];

  // Make Array say that they are Array
  if (isArray(value)) {
    array = true;
    braces = ['[', ']'];
  }

  // Make functions say that they are functions
  if (isFunction(value)) {
    var n = value.name ? ': ' + value.name : '';
    base = ' [Function' + n + ']';
  }

  // Make RegExps say that they are RegExps
  if (isRegExp(value)) {
    base = ' ' + RegExp.prototype.toString.call(value);
  }

  // Make dates with properties first say the date
  if (isDate(value)) {
    base = ' ' + Date.prototype.toUTCString.call(value);
  }

  // Make error with message first say the error
  if (isError(value)) {
    base = ' ' + formatError(value);
  }

  if (keys.length === 0 && (!array || value.length == 0)) {
    return braces[0] + base + braces[1];
  }

  if (recurseTimes < 0) {
    if (isRegExp(value)) {
      return ctx.stylize(RegExp.prototype.toString.call(value), 'regexp');
    } else {
      return ctx.stylize('[Object]', 'special');
    }
  }

  ctx.seen.push(value);

  var output;
  if (array) {
    output = formatArray(ctx, value, recurseTimes, visibleKeys, keys);
  } else {
    output = keys.map(function(key) {
      return formatProperty(ctx, value, recurseTimes, visibleKeys, key, array);
    });
  }

  ctx.seen.pop();

  return reduceToSingleString(output, base, braces);
}


function formatPrimitive(ctx, value) {
  if (isUndefined(value))
    return ctx.stylize('undefined', 'undefined');
  if (isString(value)) {
    var simple = '\'' + JSON.stringify(value).replace(/^"|"$/g, '')
                                             .replace(/'/g, "\\'")
                                             .replace(/\\"/g, '"') + '\'';
    return ctx.stylize(simple, 'string');
  }
  if (isNumber(value))
    return ctx.stylize('' + value, 'number');
  if (isBoolean(value))
    return ctx.stylize('' + value, 'boolean');
  // For some reason typeof null is "object", so special case here.
  if (isNull(value))
    return ctx.stylize('null', 'null');
}


function formatError(value) {
  return '[' + Error.prototype.toString.call(value) + ']';
}


function formatArray(ctx, value, recurseTimes, visibleKeys, keys) {
  var output = [];
  for (var i = 0, l = value.length; i < l; ++i) {
    if (hasOwnProperty(value, String(i))) {
      output.push(formatProperty(ctx, value, recurseTimes, visibleKeys,
          String(i), true));
    } else {
      output.push('');
    }
  }

  shims.forEach(keys, function(key) {
    if (!key.match(/^\d+$/)) {
      output.push(formatProperty(ctx, value, recurseTimes, visibleKeys,
          key, true));
    }
  });
  return output;
}


function formatProperty(ctx, value, recurseTimes, visibleKeys, key, array) {
  var name, str, desc;
  desc = shims.getOwnPropertyDescriptor(value, key) || { value: value[key] };
  if (desc.get) {
    if (desc.set) {
      str = ctx.stylize('[Getter/Setter]', 'special');
    } else {
      str = ctx.stylize('[Getter]', 'special');
    }
  } else {
    if (desc.set) {
      str = ctx.stylize('[Setter]', 'special');
    }
  }

  if (!hasOwnProperty(visibleKeys, key)) {
    name = '[' + key + ']';
  }
  if (!str) {
    if (shims.indexOf(ctx.seen, desc.value) < 0) {
      if (isNull(recurseTimes)) {
        str = formatValue(ctx, desc.value, null);
      } else {
        str = formatValue(ctx, desc.value, recurseTimes - 1);
      }
      if (str.indexOf('\n') > -1) {
        if (array) {
          str = str.split('\n').map(function(line) {
            return '  ' + line;
          }).join('\n').substr(2);
        } else {
          str = '\n' + str.split('\n').map(function(line) {
            return '   ' + line;
          }).join('\n');
        }
      }
    } else {
      str = ctx.stylize('[Circular]', 'special');
    }
  }
  if (isUndefined(name)) {
    if (array && key.match(/^\d+$/)) {
      return str;
    }
    name = JSON.stringify('' + key);
    if (name.match(/^"([a-zA-Z_][a-zA-Z_0-9]*)"$/)) {
      name = name.substr(1, name.length - 2);
      name = ctx.stylize(name, 'name');
    } else {
      name = name.replace(/'/g, "\\'")
                 .replace(/\\"/g, '"')
                 .replace(/(^"|"$)/g, "'");
      name = ctx.stylize(name, 'string');
    }
  }

  return name + ': ' + str;
}


function reduceToSingleString(output, base, braces) {
  var numLinesEst = 0;
  var length = shims.reduce(output, function(prev, cur) {
    numLinesEst++;
    if (cur.indexOf('\n') >= 0) numLinesEst++;
    return prev + cur.replace(/\u001b\[\d\d?m/g, '').length + 1;
  }, 0);

  if (length > 60) {
    return braces[0] +
           (base === '' ? '' : base + '\n ') +
           ' ' +
           output.join(',\n  ') +
           ' ' +
           braces[1];
  }

  return braces[0] + base + ' ' + output.join(', ') + ' ' + braces[1];
}


// NOTE: These type checking functions intentionally don't use `instanceof`
// because it is fragile and can be easily faked with `Object.create()`.
function isArray(ar) {
  return shims.isArray(ar);
}
exports.isArray = isArray;

function isBoolean(arg) {
  return typeof arg === 'boolean';
}
exports.isBoolean = isBoolean;

function isNull(arg) {
  return arg === null;
}
exports.isNull = isNull;

function isNullOrUndefined(arg) {
  return arg == null;
}
exports.isNullOrUndefined = isNullOrUndefined;

function isNumber(arg) {
  return typeof arg === 'number';
}
exports.isNumber = isNumber;

function isString(arg) {
  return typeof arg === 'string';
}
exports.isString = isString;

function isSymbol(arg) {
  return typeof arg === 'symbol';
}
exports.isSymbol = isSymbol;

function isUndefined(arg) {
  return arg === void 0;
}
exports.isUndefined = isUndefined;

function isRegExp(re) {
  return isObject(re) && objectToString(re) === '[object RegExp]';
}
exports.isRegExp = isRegExp;

function isObject(arg) {
  return typeof arg === 'object' && arg;
}
exports.isObject = isObject;

function isDate(d) {
  return isObject(d) && objectToString(d) === '[object Date]';
}
exports.isDate = isDate;

function isError(e) {
  return isObject(e) && objectToString(e) === '[object Error]';
}
exports.isError = isError;

function isFunction(arg) {
  return typeof arg === 'function';
}
exports.isFunction = isFunction;

function isPrimitive(arg) {
  return arg === null ||
         typeof arg === 'boolean' ||
         typeof arg === 'number' ||
         typeof arg === 'string' ||
         typeof arg === 'symbol' ||  // ES6 symbol
         typeof arg === 'undefined';
}
exports.isPrimitive = isPrimitive;

function isBuffer(arg) {
  return arg && typeof arg === 'object'
    && typeof arg.copy === 'function'
    && typeof arg.fill === 'function'
    && typeof arg.binarySlice === 'function'
  ;
}
exports.isBuffer = isBuffer;

function objectToString(o) {
  return Object.prototype.toString.call(o);
}


function pad(n) {
  return n < 10 ? '0' + n.toString(10) : n.toString(10);
}


var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep',
              'Oct', 'Nov', 'Dec'];

// 26 Feb 16:19:34
function timestamp() {
  var d = new Date();
  var time = [pad(d.getHours()),
              pad(d.getMinutes()),
              pad(d.getSeconds())].join(':');
  return [d.getDate(), months[d.getMonth()], time].join(' ');
}


// log is just a thin wrapper to console.log that prepends a timestamp
exports.log = function() {
  console.log('%s - %s', timestamp(), exports.format.apply(exports, arguments));
};


/**
 * Inherit the prototype methods from one constructor into another.
 *
 * The Function.prototype.inherits from lang.js rewritten as a standalone
 * function (not on Function.prototype). NOTE: If this file is to be loaded
 * during bootstrapping this function needs to be rewritten using some native
 * functions as prototype setup using normal JavaScript does not work as
 * expected during bootstrapping (see mirror.js in r114903).
 *
 * @param {function} ctor Constructor function which needs to inherit the
 *     prototype.
 * @param {function} superCtor Constructor function to inherit prototype from.
 */
exports.inherits = function(ctor, superCtor) {
  ctor.super_ = superCtor;
  ctor.prototype = shims.create(superCtor.prototype, {
    constructor: {
      value: ctor,
      enumerable: false,
      writable: true,
      configurable: true
    }
  });
};

exports._extend = function(origin, add) {
  // Don't do anything if add isn't an object
  if (!add || !isObject(add)) return origin;

  var keys = shims.keys(add);
  var i = keys.length;
  while (i--) {
    origin[keys[i]] = add[keys[i]];
  }
  return origin;
};

function hasOwnProperty(obj, prop) {
  return Object.prototype.hasOwnProperty.call(obj, prop);
}

},{"_shims":37}]},{},[7])
;