var biblemesh_util = {

  NOT_DELETED_AT_TIME: '0000-01-01 00:00:00',
  
  getUTCTimeStamp: function(){
    return new Date().getTime();
  },

  notLaterThanNow: function(timestamp){
    return Math.min(biblemesh_util.getUTCTimeStamp(), timestamp);
  },

  mySQLDatetimeToTimestamp: function(mysqlDatetime) {
    // Split timestamp into [ Y, M, D, h, m, s, ms ]
    var t = mysqlDatetime.split(/[- :\.]/);

    // Apply each element to the Date function
    var d = new Date(Date.UTC(t[0], t[1]-1, t[2], t[3], t[4], t[5], t[6]));

    return d.getTime();
  },

  timestampToMySQLDatetime: function(timestamp) {
    var specifyDigits = function(number, digits) {
      return ('0000000000000' + number).substr(digits * -1);
    }

    var date = new Date(timestamp);

    return date.getUTCFullYear() + "-"
      + specifyDigits(1 + date.getUTCMonth(), 2) + "-"
      + specifyDigits(date.getUTCDate(), 2) + " "
      + specifyDigits(date.getUTCHours(), 2) + ":"
      + specifyDigits(date.getUTCMinutes(), 2) + ":"
      + specifyDigits(date.getUTCSeconds(), 2) + "."
      + specifyDigits(date.getMilliseconds(), 3);
  }

}

module.exports = biblemesh_util;