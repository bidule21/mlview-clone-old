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
        scale:41.5,
        gaugeSize:4000/41500
    },
    '31':{
        id:'NO_DFS_100M',
        scale:300,
        gaugeSize:4000/300000
    },
    '32':{
        id:'NO_DFS_200M',
        scale:500,
        gaugeSize:4000/500000
    },
    '33':{
        id:'NO_DFS_300M',
        scale:750,
        gaugeSize:4000/750000
    },
    'XXX':{
        id:'UNKNOWN',
        scale:1000,
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

    this.watcher.on('error', function (err) {
        self.emit('error', err);
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

    this.sources[INDEX_PATH].on('error', function (err) {
        self.emit('error', err);
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

    source.on('error', function (err) {
        self.emit('error', err);
    });

    return source;
};

MegalinkWatcher.prototype.updateIndex = function (data) {
    for (var idx in data) {
        var cardData = data[idx];

        // XXX if there is mismatch between index and version, this will fail
        var range = this.ranges[cardData.range];
        var card = range.cards[cardData.lane];

        range.builder.setRelay(cardData.relay);

        card.builder
            .setLane(cardData.lane)
            .setName(cardData.name)
            .setClub(cardData.club)
            .setClassName(cardData.className)
            .setCategory(cardData.category);
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
    var target = TARGET_MAP[data.targetID]; // XXX targetID might be unknown

    card.builder
        .setSeriesName(data.series)
        .setMarking(data.marking)
        .setSeriesSum(data.seriesSum)
        .setTotalSum(data.totalSum)
        .setGaugeSize(target.gaugeSize)
        .setTargetID(target.id)
        .resetShots();

    for (var idx in data.shots) {
        var shot = data.shots[idx];

        card.builder.addShotData(shot.x/target.scale, shot.y/target.scale, shot.value);
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
