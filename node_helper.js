/* Magic Mirror
 * Module: Remote Control
 *
 * By Joseph Bethge
 * MIT Licensed.
 */

const NodeHelper = require("node_helper");
const path = require("path");
const url = require("url");
const fs = require("fs");
const exec = require('child_process').exec;
const os = require('os');

module.exports = NodeHelper.create({
	// Subclass start method.
	start: function() {
		var self = this;

		console.log("Starting node helper for: " + self.name);

		// load fall back translation
		self.loadTranslation("en");

		this.configData = {};

		this.waiting = [];

		this.template = "";

		fs.readFile(path.resolve(__dirname + "/remote.html"), function(err, data) {
			self.template = data.toString();
		});

		this.expressApp.get("/remote.html", function(req, res) {
			if (self.template === "") {
				res.send(503);
			} else {
				self.callAfterUpdate(function () {
					res.contentType('text/html');
					var transformedData = self.fillTemplates(self.template);
					res.send(transformedData);
				});
			}
		});

		this.expressApp.get('/remote', function (req, res) {
			var query = url.parse(req.url, true).query;

			if (query.action)
			{
				var result = self.executeQuery(query, res);
				if (result === true) {
					return;
				}
			}
			res.send({'status': 'error', 'reason': 'unknown_command', 'info': 'original input: ' + JSON.stringify(query)});
		});
	},

	callAfterUpdate: function(callback, timeout) {
		if (timeout === undefined) {
			timeout = 3000;
		}

		var waitObject = {
			finished: false,
			run: function () {
				if (this.finished) {
					return;
				}
				this.finished = true;
				this.callback();
			},
			callback: callback
		}

		this.waiting.push(waitObject);
		this.sendSocketNotification("UPDATE");
		setTimeout(function() {
			waitObject.run();
		}, timeout);
	},

	executeQuery: function(query, res) {
		var self = this;
		var opts = {timeout: 8000};

		if (query.action === 'SHUTDOWN')
		{
			exec('sudo shutdown -h now', opts, function(error, stdout, stderr){ 
				self.checkForExecError(error, stdout, stderr, res); });
			return true;
		}
		if (query.action === 'REBOOT')
		{
			exec('sudo shutdown -r now', opts, function(error, stdout, stderr){ 
				self.checkForExecError(error, stdout, stderr, res); });
			return true;
		}
		if (query.action === 'RESTART')
		{
			exec('/usr/local/bin/pm2 restart mm', opts, function(error, stdout, stderr){
				self.sendSocketNotification('RESTART');
				self.checkForExecError(error, stdout, stderr, res); });
			return true;
		}
		if (query.action === 'MONITORON')
		{
			exec('/opt/vc/bin/tvservice --preferred && sudo chvt 6 && sudo chvt 7', opts, function(error, stdout,stderr){ 
				self.checkForExecError(error, stdout, stderr, res); });
			return true;
		}
		if (query.action === 'MONITOROFF')
		{
			exec('/opt/vc/bin/tvservice -o', opts, function(error, stdout, stderr){ 
				self.checkForExecError(error, stdout, stderr, res); });
			return true;
		}
		if (query.action === 'HIDE' || query.action === 'SHOW')
		{
			if (res) { res.send({'status': 'success'}); }
			var payload = { module: query.module, useLockStrings: query.useLockStrings };
			if (query.action === 'SHOW' && query.force === "true") {
				payload.force = true;
			}
			self.sendSocketNotification(query.action, payload);
			return true;
		}
		if (query.action === 'BRIGHTNESS')
		{
			res.send({'status': 'success'});
			self.sendSocketNotification(query.action, query.value);
			return true;
		}
		if (query.action === 'SAVE')
		{
			if (res) { res.send({'status': 'success'}); }
			self.callAfterUpdate(function () { self.saveDefaultSettings(); });
			return true;
		}
		if (query.action === 'MODULE_DATA')
		{
			self.callAfterUpdate(function () {
				var text = JSON.stringify(self.configData);
				res.contentType('application/json');
				res.send(text);
			});
			return true;
		}
        if (query.action === 'REFRESH')
        {
            if (res) { res.send({'status': 'success'}); }
            self.sendSocketNotification(query.action);
            return true;
        }
        if (query.action === 'HIDE_ALERT')
        {
            if (res) { res.send({'status': 'success'}); }
            self.sendSocketNotification(query.action);
            return true;
        }
        if (query.action === 'SHOW_ALERT')
        {
            if (res) { res.send({'status': 'success'}); }

            var type = query.type ? query.type : 'alert';
            var title = query.title ? query.title : 'Note';
            var message = query.message ? query.message : 'Attention!';
            var timer = query.timer ? query.timer : 4;

            self.sendSocketNotification(query.action, {
                type: type, title: title, message: message, timer: timer * 1000
            });
            return true;
        }
        if (query.action === 'UPDATE')
        {
            console.log('UPDATE');
            var path = __dirname + "/../../";
            var name = 'MM';

            if (query.module) {
                if(this.moduleData){
                    for (var i = 0; i < this.moduleData.length; i++) {
                        if (this.moduleData[i].identifier === query.module) {
                            path = this.moduleData[i].path;
                            name = this.format(this.moduleData[i].name);
                            break;
                        }
                    }
                }
            }

            exec("/usr/bin/git -C "+path+" pull ", function(error, stdout, stderr)
            {
                if (error)
                {
                    console.log(error);
                    if (res) { res.send({'status': 'error', 'reason': 'unknown', 'info': error}); }
                    return;
                } else {

                    if (stdout.trim() != 'Already up-to-date.')
                    {
                        console.log('RESTART');

                        exec("/usr/local/bin/pm2 restart mm", function(error, stdout, stderr){
                            self.sendSocketNotification('RESTART');
                            self.checkForExecError(error, stdout, stderr, res);
                        });
                    }else{
                        if (res) { res.send({'status': 'success','info':name+' '+stdout}); }
                    }
                }
            });

            return true;
        }
		return false;
	},

	checkForExecError: function(error, stdout, stderr, res) {
		console.log(stdout);
		console.log(stderr);
		if (error) {
			console.log(error);
			if (res) { res.send({'status': 'error', 'reason': 'unknown', 'info': error}); }
			return;
		}
		if (res) { res.send({'status': 'success'}); }
	},

	translate: function(data) {
		for (var key in this.translation) {
			var pattern = "%%TRANSLATE:" + key + "%%";
			while (data.indexOf(pattern) > -1) {
				data = data.replace(pattern, this.translation[key]);
			}
		}
		return data;
	},

	saveDefaultSettings: function() {
		var text = JSON.stringify(this.configData);

		fs.writeFile(path.resolve(__dirname + "/settings.json"), text, function(err) {
			if (err) {
				throw err;
			}
		});
	},

	in: function(pattern, string) {
		return string.indexOf(pattern) !== -1;
	},

	loadDefaultSettings: function() {
		var self = this;

		fs.readFile(path.resolve(__dirname + "/settings.json"), function(err, data) {
			if (err) {
				if (self.in("no such file or directory", err.message)) {
					return;
				}
				console.log(err);
			} else {
				var data = JSON.parse(data.toString());
				self.sendSocketNotification("DEFAULT_SETTINGS", data);
			}
		});
	},

	format: function(string) {
		string = string.replace(/MMM-/ig, "");
		return string.charAt(0).toUpperCase() + string.slice(1);
	},

    fillTemplate: function(data) {
        return this.fillUpdateMenu(this.fillEditMenu(this.translate(data)));
    },

	fillEditMenu: function(data) {

		var brightness = 100;
		if (this.configData) {
			brightness = this.configData.brightness;
		}
		data = data.replace("%%REPLACE::BRIGHTNESS%%", brightness);

		var moduleData = this.configData.moduleData;
		if (!moduleData) {
			var error =
				'<div class="menu-element button edit-menu">\n' +
					'<span class="fa fa-fw fa-exclamation-circle" aria-hidden="true"></span>\n' +
					'<span class="text">%%TRANSLATE:NO_MODULES_LOADED%%</span>\n' +
				'</div>\n';
			error = this.translate(error);
			return data.replace("<!-- EDIT_MENU_TEMPLATE -->", error);
		}

		var editMenu = [];

		for (var i = 0; i < moduleData.length; i++) {
			if (!moduleData[i]["position"]) {
				continue;
			}

			var hiddenStatus = 'toggled-on';
			if (moduleData[i].hidden) {
				hiddenStatus = 'toggled-off';
				if (moduleData[i].lockStrings && moduleData[i].lockStrings.length) {
					hiddenStatus += ' external-locked';
				}
			}

			var moduleElement =
				'<div id="' + moduleData[i].identifier + '" class="menu-element button edit-button edit-menu ' + hiddenStatus + '">\n' +
					'<span class="stack fa-fw">\n' +
						'<span class="fa fa-fw fa-toggle-on outer-label fa-stack-1x" aria-hidden="true"></span>\n' +
						'<span class="fa fa-fw fa-toggle-off outer-label fa-stack-1x" aria-hidden="true"></span>\n' +
						'<span class="fa fa-fw fa-lock inner-small-label fa-stack-1x" aria-hidden="true"></span>\n' +
					'</span>\n' +
					'<span class="text">' + this.format(moduleData[i].name) + '</span>\n' +
				'</div>\n';

			editMenu.push(moduleElement);
		}
		return data.replace("<!-- EDIT_MENU_TEMPLATE -->", editMenu.join("\n"));
	},

	fillUpdateMenu: function(data) {

		if (!this.moduleData) {
			var error =
				'<div class="menu-button update-menu">\n' +
					'<span class="fa fa-fw fa-exclamation-circle" aria-hidden="true"></span>\n' +
					'<span class="text">%%TRANSLATE:NO_MODULES_LOADED%%</span>\n' +
				'</div>\n';
			error = this.translate(error);
			return data.replace("<!-- UPDATE_MENU_TEMPLATE -->", error);
		}

		var menu = [];

		for (var i = 0; i < this.moduleData.length; i++) {
			var moduleElement =
				'<div id="' + this.moduleData[i].identifier + '" class="menu-button update-button update-menu ' + '">\n' +
					'<span class="symbol-on-show fa fa-fw fa-toggle-up" aria-hidden="true"></span>\n' +
					'<span class="text">' + this.format(this.moduleData[i].name) + '</span>\n' +
				'</div>\n';

			menu.push(moduleElement);
		}
		return data.replace("<!-- UPDATE_MENU_TEMPLATE -->", menu.join("\n"));
	},
	
	loadTranslation: function(language) {
		var self = this;

		fs.readFile(path.resolve(__dirname + "/translations/" + language + ".json"), function(err, data) {
			if (err) {
				return;
			}
			else {
				self.translation = JSON.parse(data.toString());
			}
		});
	},

	getIpAddresses: function() {
		// module started, answer with current IP address
		var interfaces = os.networkInterfaces();
		var addresses = [];
		for (var k in interfaces) {
			for (var k2 in interfaces[k]) {
				var address = interfaces[k][k2];
				if (address.family === 'IPv4' && !address.internal) {
					addresses.push(address.address);
				}
			}
		}
		return addresses;
	},

	socketNotificationReceived: function(notification, payload) {
		var self = this;

		if (notification === "CURRENT_STATUS")
		{
			this.configData = payload;
			for (var i = 0; i < this.waiting.length; i++) {
				var waitObject = this.waiting[i];

				waitObject.run();
			}
			this.waiting = [];
		}
		if (notification === "REQUEST_DEFAULT_SETTINGS")
		{
			// check if we have got saved default settings
			self.loadDefaultSettings();
		}
		if (notification === "LANG")
		{
			self.loadTranslation(payload);

			// module started, answer with current ip addresses
			self.sendSocketNotification("IP_ADDRESSES", self.getIpAddresses());
		}
		
		if (notification === "REMOTE_ACTION")
		{
			this.executeQuery(payload);
		}
		
	}
});
