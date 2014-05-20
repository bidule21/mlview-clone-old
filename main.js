var LiveShot = require('liveshot-dom');
var MegalinkWatcher = require('./MegalinkWatcher');

// setup scale
if (window.devicePixelRatio) {
    var meta = document.head.getElementsByTagName('meta')[0];
    meta.content = 'width=device-width, user-scalable=no, initial-scale=' + (1/window.devicePixelRatio);
}

// find active range
function getParameterByName(name) {
    name = name.replace(/[\[]/, "\\[").replace(/[\]]/, "\\]");
    var regex = new RegExp("[\\?&]" + name + "=([^&#]*)"),
        results = regex.exec(location.search);
    return results == null ? "" : decodeURIComponent(results[1].replace(/\+/g, " "));
}

var rangeName = getParameterByName('range');

// setup views
var rangeView = new LiveShot.MegalinkRangeView();
document.body.appendChild(rangeView.el);

var watcher = new MegalinkWatcher();
watcher.on('update', function (ranges) {
    if (ranges.length > 0) {
        setRanges(ranges);
        hideSpinner();
    } else {
        document.body.innerHTML = 'Waiting for data...';
    }
});

watcher.on('error', function (err) {
    console.error(err);
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

function setRanges(ranges) {
    var range = ranges[0]; // select the first range by default

    if (rangeName) {
        for (var idx in ranges) {
            if (ranges[idx].name == rangeName) {
                range = ranges[idx];
                break;
            }
        }
    }

    rangeView.setRange(range, true);
}
