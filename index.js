let fastcgiConnector = require('fastcgi-client');
module.exports = phpfpm;
let urlencode = require('urlencode-for-php');

/**
 * phpfpm
 * @param  options
 *
 * default options will be  { host:127.0.0.1, port:9000 }
 */
function phpfpm(options)
{
	options = options || {};
	!options.host && (options.host = '127.0.0.1');
	!options.port && (options.port = 9000);
	!options.documentRoot && (options.documentRoot = '');
	!options.remote_addr && (options.remote_addr = '127.0.0.1');
	!options.remote_port && (options.remote_port = 1234);
	!options.server_addr && (options.server_addr = '127.0.0.1');
	!options.server_port && (options.server_port = 80);
	!options.server_name && (options.server_name = '127.0.0.1');
	!options.server_software && (options.server_software = 'Apache 2');


	this.options = options;
	let self = this;
	options.skipCheckServer = true;
	this.client = fastcgiConnector(options);
	this.ready = false;
	this.client.on('ready', function()
	{
		self.ready = true;
		self._clearQueue();
	});
	this.queue = [];
}

/**
 * clear the queued tasks after connected to phpfpm
 */
phpfpm.prototype._clearQueue = function()
{
	let evt;
	while(evt = this.queue.shift())
	{
		this.run(evt.info, evt.cb);
	}
};

/**
 * send command to phpfpm to run a php script
 */
phpfpm.prototype.run = function(info, cb)
{
	if (typeof info === 'string') info = { method: 'GET', uri: info };
	if (info.url && !info.uri) info.uri = info.url;

	if (!this.ready)
	{
		this.queue.push({info: info, cb:cb});
		return;
	}

	//support form data
	if (info.form && info.method !== 'GET')
	{
		info.body = urlencode(info.form);
		info.method = 'POST';
	}

	if (info.form && info.method === 'GET')
	{
		info.body = '';
		let qs = urlencode(info.form);;
		info.uri += (info.uri.indexOf('?') === -1) ? '?' + qs : '&' + qs;
	}

	if (info.body && !info.method) info.method = 'POST';

	//support json data
	if (info.json)
	{
		info.body = JSON.stringify(info.json);
		info.method = 'POST';
		info.contentType = 'application/json';
	}

	!info.method && (info.method = 'GET');
	info.method = info.method.toUpperCase();
	if (info.method == 'POST')
	{
		!info.body && (info.body = '');
		if (typeof info.body === 'string') info.body = new Buffer(info.body, 'utf8');
		!info.contentType && (info.contentType = 'application/x-www-form-urlencoded');
		!info.contentLength && (info.contentLength = info.body.length);
	}

	if (info.uri.match(/\?/))
	{
		let ms = info.uri.match(/^([^\?]+)\?(.*)$/);
		info.queryString = ms[2];
		info.uri = ms[1];
	}

	let phpfile = info.uri;
	if (!phpfile.match(/^\//)) phpfile = this.options.documentRoot + phpfile;


	// Default server lets
	let fastcgiParams = info.fastcgiParams || {
		QUERY_STRING: info.queryString || '',
		REQUEST_METHOD: info.method,
		CONTENT_TYPE: info.contentType || '',
		CONTENT_LENGTH: info.contentLength || '',
		SCRIPT_FILENAME: phpfile,
		SCRIPT_NAME: phpfile.split('/').pop(),
		REQUEST_URI: info.uri,
		DOCUMENT_URI: phpfile,
		DOCUMENT_ROOT: this.options.documentRoot,
		SERVER_PROTOCOL: 'HTTP/1.1',
		GATEWAY_INTERFACE: 'CGI/1.1',
		REMOTE_ADDR: this.options.remote_addr,
		REMOTE_PORT: this.options.remote_port,
		SERVER_ADDR: this.options.server_addr,
		SERVER_PORT: this.options.server_port,
		SERVER_NAME: this.options.server_name,
		SERVER_SOFTWARE: this.options.server_software,
		REDIRECT_STATUS: 200
	};


	let self = this;

	self.client.request(fastcgiParams, function(err, request)
	{
		if (err)
		{
			cb(99, err.toString(), err.toString());
			return;
		}

		let body = '',errors = '';
		request.stdout.on('data', function(data)
		{
			body += data.toString('utf8');
		});

		request.stderr.on('data', function(data)
		{
			errors += data.toString('utf8');
		});
		
		request.stdout.on('end', function()
		{
			body = body.replace(/^[\s\S]*?\r\n\r\n/, '');
			cb(false, body, errors);
		});

		if (info.method === 'POST')
		{
			request.stdin._write(info.body, 'utf8');
		}
		request.stdin.end();
	});
};
