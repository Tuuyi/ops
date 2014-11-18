var _ = require('lodash');

module.exports = EC2;
function EC2(argv) {
  var AWS = new require('./aws')(argv);
  var ec2 = AWS.EC2.apply(AWS, arguments);

  function instances(params) {
    return ec2.describeInstancesAsync(params).then(function(data) {
      return _.flatten(_.map(data.Reservations, function(r) {
        return r.Instances;
      }));
    });
  }

  function instancesById(instanceIds) {
    return this.instances({InstanceIds: _.flatten([instanceIds])});
  }

  function instanceById(instanceId) {
    return this.instancesById([instanceId]).then(_.head);
  }

  this.instances = instances;
  this.instancesById = instancesById;
  this.instanceById = instanceById;

  return this;
}

if (!module.parent) {
  // looking for --region
  var argv = require('minimist')(process.argv.slice(2));
  var ec2 = EC2(argv);

  // one or more
  if (argv.id) {
    if (Array.isArray(argv.id)) {
      ec2.instancesById(argv.id).then(console.log);
    } else {
      ec2.instanceById(argv.id).then(console.log);
    }
  // all instances
  } else {
    ec2.instances().then(console.log);
  }
}
