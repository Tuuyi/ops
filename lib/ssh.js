var ssh2 = require('ssh2');
var Promise = require('bluebird');

/**
 * Extends ssh2 module with promises and a bufferedExec method.
 */
module.exports = ssh;
function ssh(params, with_disposer) {
  var prom = new Promise(function(resolve, reject) {
    var conn = new ssh2();
    conn.on('ready', function() { resolve(_decorate(conn)); });
    conn.on('error', function(err) { reject(err); });
    conn.connect.call(conn, params);
  });

  if (with_disposer) {
    return prom.disposer(function(connection) {
      connection.end();
    });
  } else {
    return prom;
  }
}

/** Promisify, add bufferedExec. Does NOT close the connection. */
function _decorate(conn) {
  conn.bufferedExec = function() {
    var args = Array.prototype.slice.call(arguments);
    var cb = args.pop();

    // new callback handler
    args.push(function(err, stream) {
      if (err) return cb(err);

      var stderr = [];
      var stdout = [];
      var code = -1;
      var signal = undefined;

      stream.on('exit', function(code, signal) {
        stdout.length
        cb(null, {
          _conn: conn,
          stderr: Buffer.concat(stderr),
          stdout: Buffer.concat(stdout),
          code: code,
          signal: signal
        });
      }).on('data', function(data) {
        stdout.push(data);
      }).stderr.on('data', function(data) {
        stderr.push(data);
      });
    });

    conn.exec.apply(conn, args);
    return conn;
  };

  "exec bufferedExec shell forwardIn unforwardIn forwardOut sftp subsys".split(" ")
  .forEach(function(f) {
    conn[f + "Async"] = Promise.promisify(conn[f]);
  });

  return conn;
}


if (!module.parent) {
  var argv = require('minimist')(process.argv.slice(2));

  if (process.env.SSH_AUTH_SOCK) {
    doIt({
      host: argv.host || "localhost",
      username: argv.user || process.env.USER,
      agent: process.env.SSH_AUTH_SOCK
    });
  } else {
    using_privkey();
  }

  function doIt(params) {
    // @see https://github.com/petkaantonov/bluebird/blob/master/API.md#resource-management
    Promise.using(ssh(params, true), function(conn) {
      return conn.bufferedExecAsync('uptime | xargs echo "foo: $HOME: "');
      // return conn.bufferedExecAsync('grep "org.apache.catalina.startup.Catalina.start Server startup" /usr/local/tomcat/logs/catalina.out | tail -n1')
    }).then(function(child) {
      console.log(Object.keys(child));
      console.log(child.stdout.toString());
      console.log(child.code);

      // only need these if with_disposer is not true;
      //child._conn.end();
      return child;
    }).then(function(child) {
      console.error("Exiting...")
      process.exit(child.code);
    });
  }

  function using_privkey() {
    // hackety password reading from commandline version.
    var passphrase = "";
    process.stdout.write("Passphrase: ");
    process.stdin.setEncoding('utf8');
    process.stdin.setRawMode(true);

    process.stdin.on('readable', function() {
      var char = process.stdin.read();
      if (char !== null) {
        switch (char) {
          case "\n": case "\r": case "\u0004":
            // They've finished typing their password
            process.stdin.setRawMode(false);
          process.stdin.emit('passphrase', passphrase);
          break;
          case "\u0003":
            // Ctrl C
            process.exit();
          break;
          default:
            // More passsword characters
            passphrase += char;
          break;
        }
      }
    });

    // this is a made up event emitted above
    process.stdin.on('passphrase', function(passphrase) {
      doIt({
        username: process.env.USER,
        host: "localhost",
        privateKey: require('fs').readFileSync(process.env.HOME + '/.ssh/identity'),
        passphrase: passphrase
      });
    });
  }
}
