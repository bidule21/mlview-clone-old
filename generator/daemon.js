var express = require('express');
var http = require('http');
var path = require('path');
var fs = require('fs');

// --- Configuration ---
var PORT = 8080;

// --- Setup express ---
var app = express();

var frontendPath = path.join(__dirname, 'frontend');
app.use(express.static(frontendPath));

var server = http.createServer(app);
server.listen(PORT);

// --- Generate cards ---
var series = ['Prøve', 'Ligg', 'Stå', 'Kne', 'Grunnlag',  'Omgang'];
var marking = [false, true, true, true, true, true];
var maxShots = [10, 5, 5, 5, 10, 10];

var versions = {
    'index.txt':0,
    '100M_1.txt':0,
    '100M_2.txt':0,
    '100M_3.txt':0,
    '100M_4.txt':0,
    '100M_5.txt':0,
    '100M_6.txt':0,
    '100M_7.txt':0,
    '100M_8.txt':0,
    '100M_9.txt':0,
    '100M_10.txt':0
}

var seriesSum = {
    '100M_1.txt':0,
    '100M_2.txt':0,
    '100M_3.txt':0,
    '100M_4.txt':0,
    '100M_5.txt':0,
    '100M_6.txt':0,
    '100M_7.txt':0,
    '100M_8.txt':0,
    '100M_9.txt':0,
    '100M_10.txt':0
};

var totalSum = {
    '100M_1.txt':0,
    '100M_2.txt':0,
    '100M_3.txt':0,
    '100M_4.txt':0,
    '100M_5.txt':0,
    '100M_6.txt':0,
    '100M_7.txt':0,
    '100M_8.txt':0,
    '100M_9.txt':0,
    '100M_10.txt':0
};

var seriesCenterTens = {
    '100M_1.txt':0,
    '100M_2.txt':0,
    '100M_3.txt':0,
    '100M_4.txt':0,
    '100M_5.txt':0,
    '100M_6.txt':0,
    '100M_7.txt':0,
    '100M_8.txt':0,
    '100M_9.txt':0,
    '100M_10.txt':0
};

var totalCenterTens = {
    '100M_1.txt':0,
    '100M_2.txt':0,
    '100M_3.txt':0,
    '100M_4.txt':0,
    '100M_5.txt':0,
    '100M_6.txt':0,
    '100M_7.txt':0,
    '100M_8.txt':0,
    '100M_9.txt':0,
    '100M_10.txt':0
};

var shots = {
    '100M_1.txt':'',
    '100M_2.txt':'',
    '100M_3.txt':'',
    '100M_4.txt':'',
    '100M_5.txt':'',
    '100M_6.txt':'',
    '100M_7.txt':'',
    '100M_8.txt':'',
    '100M_9.txt':'',
    '100M_10.txt':''
};

var numShots = {
    '100M_1.txt':0,
    '100M_2.txt':0,
    '100M_3.txt':0,
    '100M_4.txt':0,
    '100M_5.txt':0,
    '100M_6.txt':0,
    '100M_7.txt':0,
    '100M_8.txt':0,
    '100M_9.txt':0,
    '100M_10.txt':0
};

var seriesNum = {
    '100M_1.txt':0,
    '100M_2.txt':0,
    '100M_3.txt':0,
    '100M_4.txt':0,
    '100M_5.txt':0,
    '100M_6.txt':0,
    '100M_7.txt':0,
    '100M_8.txt':0,
    '100M_9.txt':0,
    '100M_10.txt':0
};

function iterateCard(file, lane) {
    if (numShots[file] == maxShots[seriesNum[file]]) {
        numShots[file] = 0;
        seriesNum[file] = (seriesNum[file] + 1) % marking.length;
        seriesSum[file] = 0;
        shots[file] = '';

        if (seriesNum[file] == 0) {
            totalSum[file] = 0;
        }
    } else {
        ++numShots[file];

        var r = 0.3* Math.pow(Math.random(), 4);
        var t = Math.random() * 2*Math.PI;

        var x = r*Math.cos(t);
        var y = r*Math.sin(t);
        var v = Math.floor(100*(1 - (r - 4000/41500)))/10;

        if (marking[seriesNum[file]]) {
            seriesSum[file] += Math.floor(v);
            totalSum[file] += Math.floor(v);
        }

        if (v >= 10.5) {
            v = '*.' + Math.round((v - 10)*10);

            if (marking[seriesNum[file]]) {
                ++seriesCenterTens[file];
                ++totalCenterTens[file];
            }
        } else if (v >= 10) {
            v = 'X.' + Math.round((v - 10)*10);
        } else if (v == Math.round(v)) {
            v = v + '.0';
        }

        shots[file] += '[' + numShots[file] + ']\r\n';
        shots[file] += 'X=' + x + '\r\n';
        shots[file] += 'Y=' + y + '\r\n';
        shots[file] += 'V=' + v + '\r\n';
    }

    var data = '';

    data += 'Nr=' + lane + '\r\n';
    data += 'Name=' + series[seriesNum[file]] + '\r\n';
    data += 'Marking=' + (marking[seriesNum[file]] ? 'True' : 'False') + '\r\n';
    data += 'Series=' + seriesSum[file] + '\r\n';
    data += 'SeriesCenterTens=' + seriesCenterTens[file] + '\r\n';
    data += 'Total=' + totalSum[file] + '\r\n';
    data += 'TotalCenterTens=' + totalCenterTens[file] + '\r\n';
    data += 'Count=' + numShots[file] + '\r\n';
    data += shots[file];

    fs.writeFileSync(path.join(__dirname, 'frontend', file), data);
    console.log('iterate ' + file);

    ++versions[file];
    writeVersion();
}

function writeVersion() {
    var data = '';

    for (var file in versions) {
        data += file + ';' + versions[file] + '\r\n';
    }

    fs.writeFileSync(path.join(__dirname, 'frontend', 'version.txt'), data);
}

var lanes = [];

function fillLanes() {
    for (var i = 1; i <= 10; ++i) {
        lanes.push(i);
    }
}

function pickLane() {
    if (lanes.length == 0) {
        fillLanes();
    }

    var idx = Math.floor(Math.random()*lanes.length);

    return lanes.splice(idx, 1);
}

setInterval(function () {
    var lane = pickLane();
    var file = '100M_' + lane + '.txt';

    iterateCard(file, lane);
}, 500);
