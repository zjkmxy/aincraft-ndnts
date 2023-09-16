build:
	npx webpack --config webpack.config.js
	cp dist/bundle.js static/bundle.js

run:
	python3 -m http.server 9000
