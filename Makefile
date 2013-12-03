.PHONY: test

all: src/main.js
	browserify -e src/main.js -o stage/main.js

test:
	mocha --reporter spec -u tdd
