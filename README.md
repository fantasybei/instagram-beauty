instagram-scraper
=================

utility to download images from instagram via node.js

Run this commands in console:
> git clone https://github.com/vkfont/instagram-scraper.git

> npm install

> ./crawler.js



    -h, --help                     output usage information
    -V, --version                  output the version number
    -w, --workers [num]            parallel workers count, default: 10
    -d, --depth [num]              continue to collect profiles of those who like and comment fotos on previous iteration
    -c, --check                    check output if user already crawled, default: false
    -o, --output [dir]             directory where to save data, default: current directory
    -i, --input [filename|string]  file with instagram logins or login, required
