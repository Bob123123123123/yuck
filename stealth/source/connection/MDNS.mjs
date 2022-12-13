
import dgram from 'dgram';

import { Emitter, isBuffer, isFunction, isNumber, isObject } from '../../extern/base.mjs';
import { IP                                                } from '../../source/parser/IP.mjs';
import { URL                                               } from '../../source/parser/URL.mjs';
import { DNS as PACKET                                     } from '../../source/packet/DNS.mjs';



const onconnect = function(connection, url) {

	connection.type = 'client';

	try {
		connection.socket.addMembership(connection.multicast.host.ip);
	} catch (err) {
		// Do Nothing
	}

	connection.socket.on('message', (message) => {
		onmessage(connection, url, message);
	});

	setTimeout(() => {
		connection.emit('@connect');
	}, 0);

};

const onmessage = function(connection, url, message) {

	if (connection.multicast.silent === true) {

		// XXX: This was us, ignore message
		connection.multicast.silent = false;

	} else {

		MDNS.receive(connection, message, (frame) => {

			if (frame !== null) {

				url.headers = frame.headers;
				url.payload = frame.payload;

				if (frame.headers['@type'] === 'request') {
					connection.emit('request', [ frame ]);
				} else if (frame.headers['@type'] === 'response') {
					connection.emit('response', [ frame ]);
				}

			}

		});

	}

};

const ondisconnect = function(connection, url) {

	if (connection.type === 'client') {

		if (url.headers === null) {
			connection.emit('error', [{ type: 'connection', cause: 'socket-stability' }]);
		}

	}

	connection.disconnect();

};

const onupgrade = function(connection, url) {

	connection.type = 'server';

	try {

		connection.socket.bind(connection.multicast.port, () => {
			connection.socket.addMembership(connection.multicast.host.ip);
		});

	} catch (err) {

		if (err.code === 'ERR_SOCKET_ALREADY_BOUND') {

			try {
				connection.socket.addMembership(connection.multicast.host.ip);
			} catch (err) {
				// Do Nothing
			}

		}

	}

	connection.socket.on('message', (message, rinfo) => {

		connection.remote = null;

		let host = IP.parse(rinfo.address);
		let port = rinfo.port;
		if (
			IP.isIP(host) === true
			&& isNumber(port) === true
		) {
			connection.remote = {
				host: host,
				port: port
			};
		}

		onmessage(connection, url, message);

		connection.remote = null;

	});

	setTimeout(() => {
		connection.emit('@connect');
	}, 0);

};



const isConnection = function(obj) {
	return Object.prototype.toString.call(obj) === '[object Connection]';
};

const isSocket = function(obj) {

	if (obj !== null && obj !== undefined) {
		return obj instanceof dgram.Socket;
	}

	return false;

};

const Connection = function(socket) {

	socket = isSocket(socket) ? socket : null;


	this.multicast = {
		host:   null,
		port:   5353,
		silent: false
	};

	this.socket = socket;
	this.remote = null;
	this.type   = null;

	if (this.socket !== null) {

		if (this.socket.type === 'udp4') {
			this.multicast.host = IP.parse('224.0.0.251');
		} else if (this.socket.type === 'udp6') {
			this.multicast.host = IP.parse('ff02::fb');
		}

	}



	Emitter.call(this);

};


Connection.from = function(json) {

	if (isObject(json) === true) {

		let type = json.type === 'Connection' ? json.type : null;
		let data = isObject(json.data)        ? json.data : null;

		if (type !== null && data !== null) {

			let connection = new Connection();

			return connection;

		}

	} else if (isConnection(json) === true) {

		if ((json instanceof Connection) === true) {

			return json;

		} else {

			let socket     = json.socket || null;
			let connection = new Connection(socket);

			Object.keys(connection).forEach((property) => {

				if (
					json[property] === undefined
					|| json[property] === null
				) {
					json[property] = connection[property];
				}

			});

			return json;

		}

	}


	return null;

};


Connection.isConnection = isConnection;


Connection.prototype = Object.assign({}, Emitter.prototype, {

	[Symbol.toStringTag]: 'Connection',

	toJSON: function() {

		let blob = Emitter.prototype.toJSON.call(this);
		let data = {
			local:     null,
			multicast: null,
			remote:    null,
			events:    blob.data.events,
			journal:   blob.data.journal
		};

		if (this.socket !== null) {

			let address = null;

			try {
				address = this.socket.address();
			} catch (err) {
				address = null;
			}

			if (address !== null) {

				let local = {
					host: IP.parse(address.address),
					port: address.port
				};

				if (
					IP.isIP(local.host) === true
					&& isNumber(local.port) === true
				) {
					data.local = local;
				}

			}

		}

		let multicast = this.multicast || null;
		if (multicast !== null) {

			if (
				IP.isIP(multicast.host) === true
				&& isNumber(multicast.port) === true
			) {
				data.multicast = multicast;
			}

		}

		let remote = this.remote || null;
		if (remote !== null) {

			if (
				IP.isIP(remote.host) === true
				&& isNumber(remote.port) === true
			) {
				data.remote = remote;
			}

		}

		return {
			'type': 'Connection',
			'data': data
		};

	},

	disconnect: function() {

		if (this.socket !== null) {

			this.socket.removeAllListeners('listening');
			this.socket.removeAllListeners('message');
			this.socket.removeAllListeners('error');
			this.socket.removeAllListeners('close');

			try {
				this.socket.close();
			} catch (err) {
				// Do nothing
			}

			this.socket = null;

			this.emit('@disconnect');

		}

	}

});



const MDNS = {

	connect: function(url, connection) {

		url        = isObject(url)            ? Object.assign(URL.parse(), url) : null;
		connection = isConnection(connection) ? Connection.from(connection)     : new Connection();


		if (url !== null) {

			let hosts = IP.sort(url.hosts);
			if (hosts.length > 0) {

				if (connection.socket === null) {

					let type = null;

					if (hosts[0].type === 'v4') {
						type = 'udp4';
					} else if (hosts[0].type === 'v6') {
						type = 'udp6';
					}

					try {

						connection.multicast = {
							host: hosts[0],
							port: url.port || 5353
						};

						connection.socket = dgram.createSocket({
							type:      type,
							reuseAddr: true
						});

						connection.socket.bind(connection.multicast.port, () => {

							connection.socket.setMulticastLoopback(false);
							connection.socket.setMulticastTTL(1);
							connection.socket.setTTL(1);

							onconnect(connection, url);

						});

					} catch (err) {
						connection.socket = null;
					}

				} else {

					connection.multicast = {
						host: hosts[0],
						port: url.port || 5353
					};

					try {
						connection.socket.setMulticastLoopback(false);
						connection.socket.setMulticastTTL(1);
						connection.socket.setTTL(1);
					} catch (err) {
						connection.socket = null;
					}

					setTimeout(() => {
						onconnect(connection, url);
					}, 0);

				}


				if (connection.socket !== null) {

					connection.socket.removeAllListeners('message');
					connection.socket.removeAllListeners('error');
					connection.socket.removeAllListeners('close');

					connection.socket.on('error', () => {

						if (connection.socket !== null) {
							ondisconnect(connection, url);
						}

					});

					connection.socket.on('close', () => {

						if (connection.socket !== null) {
							ondisconnect(connection, url);
						}

					});

					return connection;

				} else {

					connection.socket = null;
					connection.emit('error', [{ type: 'connection' }]);

					return null;

				}

			} else {

				connection.socket = null;
				connection.emit('error', [{ type: 'host' }]);

				return null;

			}

		} else {

			connection.socket = null;
			connection.emit('error', [{ type: 'connection' }]);

			return null;

		}

	},

	disconnect: function(connection) {

		connection = isConnection(connection) ? connection : null;


		if (connection !== null) {

			connection.disconnect();

			return true;

		}


		return false;

	},

	receive: function(connection, buffer, callback) {

		connection = isConnection(connection) ? connection : null;
		buffer     = isBuffer(buffer)         ? buffer     : null;
		callback   = isFunction(callback)     ? callback   : null;


		if (buffer !== null) {

			let data = PACKET.decode(connection, buffer);
			if (data !== null) {

				if (callback !== null) {

					callback({
						headers: data.headers,
						payload: data.payload
					});

				} else {

					return {
						headers: data.headers,
						payload: data.payload
					};

				}

			} else {

				if (callback !== null) {
					callback(null);
				} else {
					return null;
				}

			}

		} else {

			if (callback !== null) {
				callback(null);
			} else {
				return null;
			}

		}

	},

	send: function(connection, data, callback) {

		connection = isConnection(connection) ? connection : null;
		data       = isObject(data)           ? data       : { headers: {}, payload: null };
		callback   = isFunction(callback)     ? callback   : null;


		if (connection !== null && connection.socket !== null) {

			let old_type = connection.type;
			let tmp_type = connection.type;

			if (data.headers['@type'] === 'request') {
				tmp_type = 'client';
			} else if (data.headers['@type'] === 'response') {
				tmp_type = 'server';
			}

			connection.type = tmp_type;

			let buffer = PACKET.encode(connection, {
				headers: data.headers || {},
				payload: data.payload || null
			});

			connection.type = old_type;


			if (buffer !== null) {


				if (connection.type === 'client') {

					connection.multicast.silent = true;

					connection.socket.send(buffer, connection.multicast.port, connection.multicast.host.ip, (err) => {

						if (err === null) {

							if (callback !== null) {
								callback(true);
							}

						} else {

							if (callback !== null) {
								callback(false);
							}

						}

					});

					if (callback === null) {
						return true;
					}

				} else if (connection.type === 'server') {

					connection.multicast.silent = true;

					connection.socket.send(buffer, connection.multicast.port, connection.multicast.host.ip, (err) => {

						if (err === null) {

							if (callback !== null) {
								callback(true);
							}

						} else {

							if (callback !== null) {
								callback(false);
							}

						}

					});

					if (callback === null) {
						return true;
					}

				}

			} else {

				if (callback !== null) {
					callback(false);
				} else {
					return false;
				}

			}

		} else {

			if (callback !== null) {
				callback(false);
			} else {
				return false;
			}

		}

	},

	upgrade: function(tunnel, url) {

		if (URL.isURL(url) !== true) {
			url = Object.assign(URL.parse(), { headers: {} }, url);
		}


		let connection = null;

		if (tunnel === null) {

			if (URL.isURL(url) === true && url.protocol === 'mdns') {

				let hosts = IP.sort(url.hosts);
				if (hosts.length > 0) {

					let host = hosts[0];
					if (host.type === 'v4') {

						connection = new Connection(dgram.createSocket({
							type:      'udp4',
							reuseAddr: true
						}));

						connection.multicast.host = host;

					} else if (host.type === 'v6') {

						connection = new Connection(dgram.createSocket({
							type:      'udp6',
							reuseAddr: true
						}));

						connection.multicast.host = host;

					}

					let port = url.port;
					if (isNumber(port) === true) {
						connection.multicast.port = port;
					}

				}

			}

		} else if (isSocket(tunnel) === true) {
			connection = new Connection(tunnel);
		} else if (isConnection(tunnel) === true) {
			connection = Connection.from(tunnel);
		}


		if (connection !== null) {

			try {
				connection.socket.setMulticastLoopback(false);
				connection.socket.setMulticastTTL(1);
				connection.socket.setTTL(1);
			} catch (err) {
				// Do Nothing
			}

			connection.socket.removeAllListeners('listening');
			connection.socket.removeAllListeners('message');
			connection.socket.removeAllListeners('error');
			connection.socket.removeAllListeners('close');

			connection.socket.on('error', () => {

				if (connection.socket !== null) {
					ondisconnect(connection, url);
				}

			});

			connection.socket.on('close', () => {

				if (connection.socket !== null) {
					ondisconnect(connection, url);
				}

			});

			onupgrade(connection, url);

			return connection;

		}


		return null;

	}

};


export { MDNS };

