// requires
var express = require('express');
var app = express();
var http = require('http');
var bodyParser = require('body-parser');
var fs = require('fs');
var path = require('path');
var mysql = require('mysql');
var AWS = require('aws-sdk');

// get process arguments
var args = process.argv.slice(2);

function normalizePort(val) {
  var port = parseInt(val, 10);

  if (isNaN(port)) {
    // named pipe
    return val;
  }

  if (port >= 0) {
    // port number
    return port;
  }

  return false;
}

// set the port
var port = normalizePort(process.env.PORT || '8080');
for (var i = 0; i < args.length; i++) {
    if (args[i] === "-p") {
        if (++i < args.length) port = args[i];
        console.log(port);
        break;
    }
}
app.set('port', port);

// Create HTTP server.
var server = http.createServer(app);

// set the app path
var PATH = '/index.html';
for (var i = 0; i < args.length; i++) {
    if (args[i] === "-OPEN") {
        args.splice(i, 1);
        
        if (i < args.length) {
            PATH = args[i];
            args.splice(i, 1);
        }
        
        console.log(PATH);
        break;
    }
}
var onDev = PATH != '/index.html';

// authenticate
var bookIds = [1,2,3];

// setup Amazon S3
var s3 = new AWS.S3()
// var myCredentials = new AWS.CognitoIdentityCredentials({IdentityPoolId:''});
var myConfig = new AWS.Config({
  // credentials: myCredentials,
  region: 'us-west-2'
});

// connect to the database
var connection = mysql.createConnection({
  host: process.env.RDS_HOSTNAME || 'localhost',
  port: process.env.RDS_PORT || '3306',
  user: process.env.RDS_USERNAME || 'root',
  password: process.env.RDS_PASSWORD || '',
  database: process.env.RDS_DB_NAME || 'ReadiumData',
  multipleStatements: true,
  dateStrings: true
})

// date and time functions
var getUTCTimeStamp = function(){
    return parseInt(new Date().getTime() / 1000);
}

var notLaterThanNow = function(timestamp){
    return Math.min(getUTCTimeStamp(), timestamp);
}

var mySQLDatetimeToTimestamp = function(mysqlDatetime) {
  // Split timestamp into [ Y, M, D, h, m, s ]
  var t = mysqlDatetime.split(/[- :]/);

  // Apply each element to the Date function
  var d = new Date(Date.UTC(t[0], t[1]-1, t[2], t[3], t[4], t[5]));

  return parseInt(d.getTime() / 1000);
}

var timestampToMySQLDatetime = function(timestamp) {
  var twoDigits = function(d) {
      if(0 <= d && d < 10) return "0" + d.toString();
      if(-10 < d && d < 0) return "-0" + (-1*d).toString();
      return d.toString();
  }

  var date = new Date(timestamp*1000);

  return date.getUTCFullYear() + "-"
    + twoDigits(1 + date.getUTCMonth()) + "-"
    + twoDigits(date.getUTCDate()) + " "
    + twoDigits(date.getUTCHours()) + ":"
    + twoDigits(date.getUTCMinutes()) + ":"
    + twoDigits(date.getUTCSeconds());
}

var paramsOk = function(params, reqParams, optParams) {
  reqParams = reqParams || [];
  optParams = optParams || [];
  var numReqParamPresent = 0;
  for(var param in params) {
    var inReqParams = reqParams.indexOf(param) != -1;
    if(inReqParams) {
      numReqParamPresent++;
    }
    if(!inReqParams && optParams.indexOf(param) == -1) {
      return false;
    }
  }
  if(Object.keys(reqParams).length != numReqParamPresent) {
    return false;
  }
  return true;
}

app.use(bodyParser.json()); // for parsing application/json
app.use(bodyParser.urlencoded({ extended: true }));

// route RequireJS_config.js properly
app.get(['/RequireJS_config.js', '/book/RequireJS_config.js'], function (req, res) {
  res.sendFile(path.join(process.cwd(), 'dev/RequireJS_config.js'))
})

// Accepts GET method to retrieve the app
// read.biblemesh.com
// read.biblemesh.com/book/{book_id}
app.get(['/', '/book/:bookId'], function (req, res) {
  res.sendFile(path.join(process.cwd(), PATH))
})

// Accepts GET method to retrieve a book’s user-data
// read.biblemesh.com/users/{user_id}/books/{book_id}.json
app.get('/users/:userId/books/:bookId.json', function (req, res) {

  // build the userData object
  connection.query('SELECT * FROM `latest_location` WHERE user_id=? AND book_id=?', [req.params.userId, req.params.bookId] , function (err1, rows1, fields1) {
    if (err1) throw err1

    var row = rows1[0];

    if(!row) {
        res.send(null);

    } else {
      var bookUserData = {
        latest_location: row.cfi,
        updated_at: mySQLDatetimeToTimestamp(row.updated_at),
        highlights: []
      }

      var highlightFields = 'cfi, color, note, updated_at';
      connection.query('SELECT ' + highlightFields + ' FROM `highlight` WHERE user_id=? AND book_id=?', [req.params.userId, req.params.bookId] , function (err2, rows2, fields2) {

        rows2.forEach(function(row2, idx) {
          rows2[idx].updated_at = mySQLDatetimeToTimestamp(row2.updated_at);
        });

        bookUserData.highlights = rows2;
        res.send(bookUserData);

      });
    }
  })
})

// read.biblemesh.com/users/{user_id}/books/{book_id}.json
app.all('/users/:userId/books/:bookId.json', function (req, res, next) {
  
  if(req.method == 'PATCH') {

    containedOldPatch = false;

    // A JSON array of user-data book objects is sent to the Readium server,
    // which contains the portions that need to be added, updated or deleted.
    // That is, latest_location is only included if updated, and the highlights
    // array should only include added or updated highlights.

    // An updated_at UTC timestamp must be sent with each object in the request,
    // so that this timestamp can be
    // checked against the timestamp of that object on the server. The server
    // will only execute the update for that object if the sent object is newer
    // than the object on the server. This check is done on an object-by-object
    // basis, such that some may be updated, some not.

    // The _delete flag signal to delete the highlight, so long as the updated_at
    // time is newer than that on the server.

// TODO: lock and unlock tables

    connection.query('SELECT * FROM `latest_location` WHERE user_id=? AND book_id=?; '
      + 'SELECT cfi, updated_at FROM `highlight` WHERE user_id=? AND book_id=?',
      [req.params.userId, req.params.bookId, req.params.userId, req.params.bookId],
      function (err, results) {
        if (err) throw err

        var queriesToRun = [];

        var currentHighlightsUpdatedAtTimestamp = {};
        results[1].forEach(function(highlightRow) {
          currentHighlightsUpdatedAtTimestamp[highlightRow.cfi] = mySQLDatetimeToTimestamp(highlightRow.updated_at);
        })

        if(req.body.latest_location) {
          if(!paramsOk(req.body, ['updated_at','latest_location'],['highlights'])) {
            res.status(400).send();
            return;
          }

          req.body.updated_at = notLaterThanNow(req.body.updated_at);

          if((results[0].length > 0 ? mySQLDatetimeToTimestamp(results[0][0].updated_at) : 0) > req.body.updated_at) {
            containedOldPatch = true;
          } else {
            var fields = {
              cfi: req.body.latest_location,
              updated_at: timestampToMySQLDatetime(req.body.updated_at)
            };
            if(results[0].length > 0) {
              queriesToRun.push({
                query: 'UPDATE `latest_location` SET ? WHERE user_id=? AND book_id=?',
                vars: [fields, req.params.userId, req.params.bookId]
              })
            } else {
              fields.user_id = req.params.userId;
              fields.book_id = req.params.bookId;
              queriesToRun.push({
                query: 'INSERT into `latest_location` SET ?',
                vars: [fields]
              });
            }
          }
        }

        if(req.body.highlights) {
          req.body.highlights.forEach(function(highlight) {
            
            if(!paramsOk(highlight, ['updated_at','cfi'], ['color','note','_delete'])) {
              res.status(400).send();
              return;
            }
            highlight.updated_at = notLaterThanNow(highlight.updated_at);

            if((currentHighlightsUpdatedAtTimestamp[highlight.cfi] || 0) > highlight.updated_at) {
              containedOldPatch = true;
              return;
            }

            highlight.updated_at = timestampToMySQLDatetime(highlight.updated_at);
            // since I do not know whether to INSERT or UPDATE, just DELETE them all then then INSERT
            if(highlight._delete) {
              queriesToRun.push({
                query: 'DELETE FROM `highlight` WHERE user_id=? AND book_id=? AND cfi=? AND updated_at<=?',
                vars: [req.params.userId, req.params.bookId, highlight.cfi, highlight.updated_at]
              });
            } else if(currentHighlightsUpdatedAtTimestamp[highlight.cfi] != null) {
              queriesToRun.push({
                query: 'UPDATE `highlight` SET ? WHERE user_id=? AND book_id=? AND cfi=?',
                vars: [highlight, req.params.userId, req.params.bookId, highlight.cfi]
              })
            } else {
              highlight.user_id = req.params.userId;
              highlight.book_id = req.params.bookId;
              queriesToRun.push({
                query: 'INSERT into `highlight` SET ?',
                vars: highlight
              });
            }
          })
        }

        var runAQuery = function() {
          if(queriesToRun.length > 0) {
            var query = queriesToRun.shift();
            connection.query(query.query, query.vars, function (err, result) {
              if (err) {
                console.log(query);
                throw err
              }
              runAQuery();
            })
            
          } else {
            if(containedOldPatch) {
              // When one or more object was not updated due to an old updated_at timestamp (i.e. stale data).
              res.status(412).send();
            } else {
              // When there is success on all objects
              res.status(200).send();
            }
          }
        }

        runAQuery();
      }
    )

  } else {
    next();
  }
})

// get epub_library.json with library listing for given user
app.get('/epub_content/epub_library.json', function (req, res) {

  // has bookIds array from authenticate

  // look those books up in the database and form the library
  connection.query('SELECT * FROM `book` WHERE id IN(?)', [bookIds] , function (err, rows, fields) {
    if (err) throw err

    res.send(rows);

  })
})

// serve the static files
app.get('*', function (req, res) {
  var urlWithoutQuery = req.url.replace(/(\?.*)?$/, '');
  var urlPieces = urlWithoutQuery.split('/');
  var bookId = parseInt((urlPieces[2] || '0').replace(/^book_([0-9]+).*$/, '$1'));

  // check that they have access if this is a book
  if(urlPieces[1] == 'epub_content') {

    if(bookIds.indexOf(bookId) == -1) {
      res.status(403).send({ error: 'Forbidden' });
    } else {
      var params = {
        Bucket: 'biblemesh-readium',
        Key: urlWithoutQuery.replace(/^\//,'')
      };

      s3.getObject(params, function(err, data) {
        if (err) {
          res.status(404).send({ error: 'Not found' });
        } else { 
          res.set({
            LastModified: data.LastModified,
            ContentLength: data.ContentLength,
            ContentType: data.ContentType,
            ETag: data.ETag
          }).send(new Buffer(data.Body));
        }
      });
      
    }

  } else if(onDev || ['css','fonts','images','scripts'].indexOf(urlPieces[1]) != -1) {

    var staticFile = path.join(process.cwd(), urlWithoutQuery);

    if(fs.existsSync(staticFile)) {
      res.sendFile(staticFile, {
          dotfiles: "allow"
      })
    }

  } else {
    console.log('Forbidden file or directory: ' + urlPieces[1] + ' - ' + urlWithoutQuery);
    res.status(403).send({ error: 'Forbidden' });
  }
})

// catch all else
app.all('*', function (req, res) {
  res.status(404).send({ error: 'Invalid request' });
})

// Listen on provided port
server.listen(port);
