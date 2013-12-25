var EventEmitter = require('events').EventEmitter;
var inherits = require('inherits');
var IndexWatcher = require('./IndexWatcher');
var SeriesWatcher = require('./SeriesWatcher');
var LiveShot = require('liveshot-protocol');
var CardBuilder = LiveShot.CardBuilder;
var RangeBuilder = LiveShot.RangeBuilder;

// --- CONSTANTS ---
var INDEX_REFRESH = 1000;
var CARD_REFRESH = 1000;
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

function SourceWatcher(root) {
    this.root = root || '.';
    this.setup();
}

module.exports = SourceWatcher;
inherits(SourceWatcher, EventEmitter);

SourceWatcher.prototype.start = function () {
    this.indexWatcher.start();

    for (var idx in this.cardWatchers) {
        this.cardWatchers[idx].start();
    }

    this.running = true;
};

SourceWatcher.prototype.stop = function () {
    this.running = false;
    this.indexWatcher.stop();

    for (var rangeIdx in this.ranges) {
        var range = this.ranges[rangeIdx];

        for (var cardIdx in range.cards) {
            range.cards[cardIdx].watcher.stop();
        }
    }
};

// --- Internal API ---
SourceWatcher.prototype.setup = function () {
    this.indexWatcher = new IndexWatcher(this.getIndexPath(), INDEX_REFRESH);
    this.ranges = {};

    var self = this;
    this.indexWatcher.on('update', function (data) {
        self.updateIndex(data);
    });
};

SourceWatcher.prototype.updateIndex = function (data, silent) {
    for (var idx in data) {
        var cardData = data[idx];

        if (!this.ranges.hasOwnProperty(cardData.range)) {
            this.ranges[cardData.range] = {
                builder:new RangeBuilder()
                    .setName(cardData.range)
                    .setRelay(cardData.relay),
                cards:{}
            };
        }

        var range = this.ranges[cardData.range];

        if (!range.cards.hasOwnProperty(cardData.lane)) {
            range.cards[cardData.lane] = {
                watcher:this.setupSeriesWatcher(cardData),
                builder:new CardBuilder()
            };
        }

        var card = range.cards[cardData.lane];
        this.target = TARGET_MAP[cardData.targetID] || DEFAULT_TARGET;

        card.builder
            .setLane(cardData.lane)
            .setName(cardData.name)
            .setClub(cardData.club)
            .setClassName(cardData.className)
            .setCategory(cardData.category)
            .setGaugeSize(this.target.gaugeSize)
            .setTargetID(this.target.id);
    }

    if (!silent) {
        this.publishUpdate();
    }
};

SourceWatcher.prototype.setupSeriesWatcher = function (cardData) {
    var watcher = new SeriesWatcher(this.getCardPath(cardData.range, cardData.lane));

    var self = this;
    watcher.on('update', function (seriesData) {
        self.updateCard(cardData.range, cardData.lane, seriesData);
    });

    if (this.running) {
        watcher.start();
    }

    return watcher;
};

SourceWatcher.prototype.updateCard = function (range, lane, seriesData, silent) {
    var card = this.ranges[range].cards[lane];

    card.builder
        .setSeriesName(seriesData.series)
        .setMarking(seriesData.marking)
        .setSeriesSum(seriesData.seriesSum)
        .setTotalSum(seriesData.totalSum)
        .resetShots();

    for (var idx in seriesData.shots) {
        var shot = seriesData.shots[idx];
        card.builder.addShotData(shot.x/this.target.scale, shot.y/this.target.scale, shot.value);
    }

    if (!silent) {
        this.publishUpdate();
    }
};

SourceWatcher.prototype.publishUpdate = function () {
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

SourceWatcher.prototype.getIndexPath = function () {
    return this.root + '/' + INDEX_PATH;
};

SourceWatcher.prototype.getCardPath = function (range, lane) {
    return this.root + '/' + this.getCardID(range, lane) + '.txt';
};

SourceWatcher.prototype.getCardID = function (range, lane) {
    return range + '_' + lane;
};
