.PHONY: test

all: main.js
	browserify -e main.js -o stage/main.js

test:
	mocha --reporter spec -u tdd
