#!/usr/bin/env node

'use strict';

var request = require('request');
var async = require('async');
var mkdirp = require('mkdirp');
var fs = require('fs');
var program = require('commander');

var url = 'http://instagram.com/';

var defaults = {
    depth: 1,
    input: [],
    output: '.',
    workers: 10,
    check: false
};

function Crawler(config) {
    config = config || {};
    for (var key in defaults) {
        this[key] = config[key] ? config[key] : defaults[key];
    }

    this._queued = {};
    this._cachedEvalFunc = null;

    this.start = this.start.bind(this);
    this.start();
}

/**
 * Simple eval code function: not so bad as pure eval (own context) and
 * much faster than node vm
 */
Crawler.prototype.evaluateCode = function(code, context) {
    if (this._cachedEvalFunc === null) {
        this._cachedEvalFunc = new Function('return this.' + code + ';');
    }
    return this._cachedEvalFunc.call(context || {});
};

/**
 * Parse internal instagram object, return array with images and
 * last image id (for paginator)
 */
Crawler.prototype.getImages = function(items, cb) {
    var _this = this;
    var images = [];
    var lastId;
    (items || []).forEach(function(v) {
        lastId = v.id;
        if (v.type !== 'image') {
            return;
        }
        if (_this.depth > 0 && v.likes) {
            v.likes.data.forEach(function(v) {
                _this.push(v.username);
            });
        }
        if (_this.depth > 0 && v.comments) {
            v.comments.data.forEach(function(v) {
                _this.push(v.from.username);
            });
        }
        images.push({
            id: v.id,
            src: v.images.standard_resolution.url,
            caption: v.caption ? v.caption.text : null,
            link: v.link,
            likes: v.likes.count,
            created: v.created_time
        });
    });
    cb(null, images, lastId);
};

/**
 * Crawl profile by nickname and return array with images
 */
Crawler.prototype.parseProfile = function(nickname, cb) {
    var _this = this;
    var profileUrl = url + nickname;
    request(profileUrl, function(err, res, body) {
        if (err) {
            return cb(err);
        }
        var arr = body.match(/window\._sharedData.+<\/script>/);
        if (!arr.length) {
            return cb(new Error('no data found in profile'));
        }
        var sandbox = {
            window: {}
        };
        //vm.runInNewContext(arr[0].substring(0, arr[0].length - 9), sandbox);
        var result = _this.evaluateCode(arr[0].substring(0, arr[0].length - 9), sandbox);
        if (!result || !result.entry_data.UserProfile) {
            return cb(new Error('profile not found'));
        }
        var profile = result.entry_data.UserProfile[0];
        var images = [];
        _this.getImages(profile.userMedia, function(err, img, lastId) {
            if (err || !img.length) {
                return cb(err, profile.user, []);
            }
            images.push.apply(images, img);
            async.until(
                function() {
                    return !lastId;
                },
                function(cb) {
                    request({
                        url: profileUrl + '/media?max_id=' + lastId,
                        json: true
                    }, function(err, res, json) {
                        if (err || typeof json !== 'object') {
                            return cb(err || new Error('json not found'));
                        }
                        _this.getImages(json.items || [], function(err, img, _lastId) {
                            lastId = json.more_available ? _lastId : false;
                            images.push.apply(images, img);
                            cb();
                        });
                    });
                }, function(err) {
                    cb(err, profile.user, images);
                }
            );
        });
    });
};

/**
 * Save images to directory
 */
Crawler.prototype.saveImages = function(dirname, images, cb) {
    async.eachLimit(images, 10, function(img, next) {
        request(img.src, next).pipe(fs.createWriteStream(dirname + '/' + img.id + '.jpg'));
    }, cb);
};

/**
 * Add user to crawl queue
 */
Crawler.prototype.push = function(nickname) {
    nickname = nickname.trim();
    if (!nickname || this._queued[nickname]) {
        return;
    }
    this._queued[nickname] = true;

    if (this.check) {
        if (fs.existsSync(program.output + '/' + nickname)) {
            return;
        }
    }
    this.input.push(nickname);
};

/**
 * Save user data and images
 */
Crawler.prototype.save = function(nickname, cb) {
    var _this = this;
    this.parseProfile(nickname, function(err, profile, images) {
        if (err) {
            return cb(err);
        }
        var dirname = program.output + '/' + nickname;
        mkdirp(dirname, null, function(err) {
            if (err) {
                return cb(err);
            }
            fs.writeFile(dirname + '/profile.json', JSON.stringify(profile, null, '  '), 'utf-8', function() {
                _this.saveImages(dirname, images, function() {
                    fs.writeFile(dirname + '/images.json', JSON.stringify(images, null, '  '), 'utf-8', cb);
                });
            });
        });
    });
};

/**
 * Iterate over queue and save user data
 */
Crawler.prototype.start = function() {
    var _this = this;
    var items = this.input;
    this.input = [];
    async.eachLimit(items, this.workers, function(user, next) {
        _this.save(user, function(err) {
            if (err) {
                console.log('>> error durning %s crawl: %s', user, err.message);
            } else {
                console.log('>> %s success!!!', user);
            }
            next();
        });
    }, function() {
        if (--_this.depth <= 0) {
            return console.log('Finished (reached max depth)');
        }
        if (!_this.input.length) {
            return console.log('Finished (no more items in queue)');
        }
        setImmediate(this.start);
    });
};

program
    .version(require('./package.json').version)
    .option('-w, --workers [num]', 'parallel workers count, default: 10', 10)
    .option('-d, --depth [num]', 'continue to collect profiles of those who like and comment fotos on previous iteration', 1)
    .option('-c, --check', 'check output if user already crawled, default: false')
    .option('-o, --output [dir]', 'directory where to save data, default: current directory', '.')
    .option('-i, --input [filename|string]', 'file with instagram logins or login, required')
    .parse(process.argv);

if (!program.input) {
    program.help();
}

var queue = fs.existsSync(program.input) ?
    fs.readFileSync(program.input).toString().split('\n') : [program.input];

new Crawler({
    depth: program.depth,
    input: queue,
    output: program.output,
    workers: program.workers,
    check: program.check
});
