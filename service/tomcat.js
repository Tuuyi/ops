var Promise = require('bluebird');
var SSH = require('../lib/ssh');
var request = Promise.promisifyAll(require("request"));

var TOMCAT_PS_STR = 'org.apache.catalina.startup.Bootstrap';
var CATALINA_OUT = '/usr/local/tomcat/logs/catalina.out';

module.exports = function(argv) {
  var PRIME_URI = argv['prime-uri'];
  // arg is in seconds default to 1 hour.
  var PRIME_TIMEOUT = (argv['prime-max'] || 60*60) * 1000;

  if (!PRIME_URI) throw new Error("Need --prime-uri");

  return function(host, user) {
    var tomcat = new Tomcat(host, user);

    return tomcat.then(function(tomcat) {
      tomcat.PRIME_URI = PRIME_URI;
      tomcat.PRIME_TIMEOUT = PRIME_TIMEOUT;
      return tomcat;
    });
  }
}

function Tomcat(host, user) {
  var self = this;
  self.host = host;
  self.user = user || process.env.USER;

  if (!process.env.SSH_AUTH_SOCK) {
    throw new Error("This service assumes a working SSH Agent.");
  }

  console.log("Connecting to", self.user + '@' + self.host);
  return SSH({
    host: self.host,
    username: self.user,
    agent: process.env.SSH_AUTH_SOCK
  }, false).then(function(target) {
    console.log("Connected to", self.user + '@' + self.host);
    self.target = target;
    return self;
  });
}

Tomcat.prototype.stop = function(killable) {
  var self = this;
  return self.target
    .bufferedExecAsync('/usr/local/tomcat/bin/shutdown.sh')
    .tap(function() { console.log("Tomcat Shutdown Started...") })
    .delay(10000)
    .then(self.target.bufferedExecAsync.bind(self.target, 'ps ax | grep '+TOMCAT_PS_STR+' | grep -v grep'))
    .then(function(proc) {
      if (proc.code === 0) {  // when grep comes up empty handed it exits as non-zero, i.e. success is inverted here.
        if (!killable) throw new Error("Tomcat is still alive.");

        console.warn("Tomcat didn't stop, killing...");
        return self.target
            .bufferedExecAsync('ps ax | grep '+TOMCAT_PS_STR+' | grep -v grep |cut -d"?" -f1 | xargs kill -9')
            .delay(10000)
            .then(self.target.bufferedExecAsync.bind(self.target, 'ps ax | grep '+TOMCAT_PS_STR+' | grep -v grep'))
            .then(function(proc) {
              if (proc.code === 0) {  // successful exit is non-zero for our purposes.
                throw new Error("Tomcat is still alive!");
              }

              return self;
            })
      }

      return self;
    })
}

Tomcat.prototype.prime = function() {
  var url = this.PRIME_URI.replace(/%host%/g, this.host);

  console.log("Priming Tomcat with:", url);
  return request.getAsync({url: url, timeout: this.PRIME_TIMEOUT})
    // priming can timeout, etc. so we'll just try again.
    // (in truth, I don't know why request fails to come back after waiting 45 or so minutes for the prime)
    .catch(function() {
      return request.getAsync({url: url, timeout: 60000});
    })
    .then(Promise.resolve(this));
}

function StartupStringNotFound() {}
StartupStringNotFound.prototype = Object.create(Error.prototype);
/** @throws StartupStringNotFound when there is no startup message in the log. */
Tomcat.prototype.lastStarted = function() {
  return this.target
  .bufferedExecAsync('grep "org.apache.catalina.startup.Catalina.start Server startup" ' + CATALINA_OUT + ' | tail -n1')
  .then(function(proc) {
    var stdout = proc.stdout.toString();
    if (stdout.length == 0 || proc.code !== 0) throw new StartupStringNotFound();

    var lastStart = new Date(stdout.split(" INFO")[0] + " GMT");
    return lastStart;
  })
}

Tomcat.prototype.uptime = function() {
  return this.lastStarted().then(function(last) { return Date.now() - last; })
  .catch(StartupStringNotFound, function() { return Number.MAX_VALUE; })
}

/** Must be called to close the underlying ssh connection. */
Tomcat.prototype.end = function() {
  return this.target.end();
}

Tomcat.prototype.preflight = function() {
  return this.target.bufferedExecAsync("mv " + CATALINA_OUT + " " + CATALINA_OUT + ".last")
  .then(this.target.bufferedExecAsync.bind(this.target, "gzip " + CATALINA_OUT + ".last"))
  .then(Promise.resolve(this));
}

Tomcat.prototype.start = function() {
  return this.target.bufferedExecAsync('/usr/local/tomcat/bin/startup.sh')
  .tap(function() { console.log("Tomcat Starting Up...") })
  .then(this.waitForRecentStartup.bind(this))
  .timeout(60000, "Tomcat did not start up.")
  .then(Promise.resolve(this));
}

/** Repeatedly checks catalina.out for a Tomcat startup. */
Tomcat.prototype.waitForRecentStartup = function(max_age, repeat_after) {
  return this.uptime().bind(this).then(function(millisUp) {
    if (millisUp < (max_age || 60000)) {
      return true;
    } else {
      return Promise.delay(repeat_after || 5000).then(this.waitForRecentStartup.bind(this))
      .then(Promise.resolve(this));
    }
  });
}

// test
if (!module.parent) {
  var argv = require('minimist')(process.argv.slice(2));

  Promise.using(new Tomcat(argv.host, argv.user), function(service) {
    service.waitForRecentStartup(3*24*60*60*1000, 500).timeout(6000)
    .tap(console.log)
    // WARN: sloppy resource management
    .finally(service.end.bind(service));
  });

}
