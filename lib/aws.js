var _ = require('lodash');
var AWS = require('aws-sdk');
var Bluebird = require('bluebird');

var APIS = ["EC2", "ELB"];

/** @param argv process.argv after minimist is done with it.
  * @return Promisified version of AWS with region set.
  */
module.exports = function(argv) {
  if (!argv.region) {
    console.error("Must specify --region\n  $0 --region=...");
    process.exit(1);
  }
  AWS.config.region = argv.region;

  var obj = { AWS: AWS };
  _.each(APIS, function(api) {
         obj[api] = function() {
           return Bluebird.promisifyAll(new AWS[api]());
         }
  });

  return obj;
}
