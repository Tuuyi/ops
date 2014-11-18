var _ = require('lodash');

module.exports = ELB;
function ELB(argv, _descriptions) {
  var self = this;
  var AWS = new require('./aws')(argv);
  var elb = AWS.ELB.apply(AWS, arguments);

  function get(name) {
    return elb.describeLoadBalancersAsync({LoadBalancerNames: [name]}).then(function(data) {
      return new ELB(argv, data);
    });
  }

  // set up interface.
  if (_descriptions) {
    __updateMetadata({description: _descriptions});
    this._argv = argv;

    // functions
    this.__defineGetter__('name', __elbName);
    this.__defineGetter__('instances', _instanceIds);
    this.refresh = _refresh;
    this.deregister = _deregister;
    this.register = _register;
    this.instanceIds = _instanceIds;
  } else {
    this.get = get;
  }

  function __updateMetadata(params) {
    if (params.description) {
      var pd = params.description;
      self._description = (pd.LoadBalancerDescriptions ? pd.LoadBalancerDescriptions[0] : pd);
    }

    if (params.instances) {
      var old = self._description.Instances;
      self._description.Instances = params.instances;
    }

    self._updated = new Date();
  }

  function __elbName() {
    return self._description.LoadBalancerName;
  }

  function _instanceIds() {
    return self._description.Instances.map(function(v) {
      return _.isString(v) ? v : v.InstanceId;
    });
  }

  /** Update cached elb metadata */
  function _refresh() {
    return elb.describeLoadBalancersAsync(
      {LoadBalancerNames: [__elbName()]}
    ).then(function(data) {
      __updateMetadata({description: data})
      return self;
    });
  }

  function _deregister(instanceId) {
    return elb.deregisterInstancesFromLoadBalancerAsync({
      Instances: [{InstanceId: instanceId}],
      LoadBalancerName: __elbName()
    }).then(function(remainingInstances) {
      __updateMetadata({instances: remainingInstances.Instances });
      return self;
    })
  }

  function _register(instanceId) {
    return elb.registerInstancesWithLoadBalancerAsync({
      Instances: [{InstanceId: instanceId}],
      LoadBalancerName: __elbName()
    }).then(function(updatedInstances) {
      __updateMetadata({instances: updatedInstances.Instances });
      return self;
    })
  }
  return self;
}

if (!module.parent) {
  var argv = require('minimist')(process.argv.slice(2));

  var elb = ELB(argv).get('r')
  // .then(function(elb) {
  //   console.log(elb._updated);
  //   return elb.refresh();
  // })

//   .then(function(elb) {
//     console.log("Deregistering:", elb.instances[0]);
//     return elb.deregister(elb.instances[0]);

  .then(function(elb) {
    var instance = argv.instance;
    console.log("Registering:", instance);
    return elb.register(instance);

  }).then(function(elb) {
    console.log("ELB:", elb.name, elb.instances);
  });
}
