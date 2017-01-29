module.exports = function (app, connection, ensureAuthenticated) {

  // temporary
  var bookIds = 'admin';  // normal user: [1,2,3]

  var path = require('path');
  var biblemesh_util = require('./biblemesh_util');

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

  // get current milliseconds timestamp for syncing clock with the client
  app.get('/currenttime.json', function (req, res) {
    res.send({ currentServerTime: biblemesh_util.getUTCTimeStamp() });
  })

  // Accepts GET method to retrieve the app
  // read.biblemesh.com
  // read.biblemesh.com/book/{book_id}
  app.get(['/', '/book/:bookId'], ensureAuthenticated, function (req, res) {
    res.sendFile(path.join(process.cwd(), process.env.APP_PATH || '/index.html'))
  })

  // Accepts GET method to retrieve a book’s user-data
  // read.biblemesh.com/users/{user_id}/books/{book_id}.json
  app.get('/users/:userId/books/:bookId.json', ensureAuthenticated, function (req, res, next) {

    // build the userData object
    connection.query('SELECT * FROM `latest_location` WHERE user_id=? AND book_id=?',
      [req.params.userId, req.params.bookId],
      function (err, rows) {
        if (err) return next(err);

        var row = rows[0];

        if(!row) {
            res.send(null);

        } else {
          var bookUserData = {
            latest_location: row.cfi,
            updated_at: biblemesh_util.mySQLDatetimeToTimestamp(row.updated_at),
            highlights: []
          }

          var highlightFields = 'cfi, color, note, updated_at';
          connection.query('SELECT ' + highlightFields + ' FROM `highlight` WHERE user_id=? AND book_id=? AND deleted_at=?',
            [req.params.userId, req.params.bookId, biblemesh_util.NOT_DELETED_AT_TIME],
            function (err2, rows2, fields2) {

              rows2.forEach(function(row2, idx) {
                rows2[idx].updated_at = biblemesh_util.mySQLDatetimeToTimestamp(row2.updated_at);
              });

              bookUserData.highlights = rows2;
              res.send(bookUserData);

            }
          );
        }
      }
    )
  })

  // read.biblemesh.com/users/{user_id}/books/{book_id}.json
  app.all('/users/:userId/books/:bookId.json', ensureAuthenticated,function (req, res, next) {
    
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
        + 'SELECT cfi, updated_at, IF(note="", 0, 1) as hasnote FROM `highlight` WHERE user_id=? AND book_id=? AND deleted_at=?',
        [req.params.userId, req.params.bookId, req.params.userId, req.params.bookId, biblemesh_util.NOT_DELETED_AT_TIME],
        function (err, results) {
          if (err) return next(err);

          var queriesToRun = [];

          var currentHighlightsUpdatedAtTimestamp = {};
          var currentHighlightsHasNote = {};
          results[1].forEach(function(highlightRow) {
            currentHighlightsUpdatedAtTimestamp[highlightRow.cfi] = biblemesh_util.mySQLDatetimeToTimestamp(highlightRow.updated_at);
            currentHighlightsHasNote[highlightRow.cfi] = !!highlightRow.hasnote;
          })

          if(req.body.latest_location) {
            if(!paramsOk(req.body, ['updated_at','latest_location'],['highlights'])) {
              res.status(400).send();
              return;
            }

            req.body.updated_at = biblemesh_util.notLaterThanNow(req.body.updated_at);

            if((results[0].length > 0 ? biblemesh_util.mySQLDatetimeToTimestamp(results[0][0].updated_at) : 0) > req.body.updated_at) {
              containedOldPatch = true;
            } else {
              var fields = {
                cfi: req.body.latest_location,
                updated_at: biblemesh_util.timestampToMySQLDatetime(req.body.updated_at)
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
              highlight.updated_at = biblemesh_util.notLaterThanNow(highlight.updated_at);

              if((currentHighlightsUpdatedAtTimestamp[highlight.cfi] || 0) > highlight.updated_at) {
                containedOldPatch = true;
                return;
              }

              highlight.updated_at = biblemesh_util.timestampToMySQLDatetime(highlight.updated_at);
              // since I do not know whether to INSERT or UPDATE, just DELETE them all then then INSERT
              if(highlight._delete) {
                if(currentHighlightsHasNote[highlight.cfi]) {
                  var now = biblemesh_util.timestampToMySQLDatetime(biblemesh_util.getUTCTimeStamp());
                  queriesToRun.push({
                    query: 'UPDATE `highlight` SET deleted_at=? WHERE user_id=? AND book_id=? AND cfi=? AND deleted_at=?',
                    vars: [now, req.params.userId, req.params.bookId, highlight.cfi, biblemesh_util.NOT_DELETED_AT_TIME]
                  });
                } else {
                  queriesToRun.push({
                    query: 'DELETE FROM `highlight` WHERE user_id=? AND book_id=? AND cfi=? AND deleted_at=? AND updated_at<=?',
                    vars: [req.params.userId, req.params.bookId, highlight.cfi, biblemesh_util.NOT_DELETED_AT_TIME, highlight.updated_at]
                  });
                }
              } else if(currentHighlightsUpdatedAtTimestamp[highlight.cfi] != null) {
                queriesToRun.push({
                  query: 'UPDATE `highlight` SET ? WHERE user_id=? AND book_id=? AND cfi=? AND deleted_at=?',
                  vars: [highlight, req.params.userId, req.params.bookId, highlight.cfi, biblemesh_util.NOT_DELETED_AT_TIME]
                });
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
                  return next(err);
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
  app.get('/epub_content/epub_library.json', ensureAuthenticated, function (req, res, next) {

    // has bookIds array from authenticate

    // look those books up in the database and form the library
    connection.query('SELECT * FROM `book`' + (bookIds=='admin' ? '' : ' WHERE id IN(?)'), [bookIds.concat([-1])] , function (err, rows, fields) {
      if (err) return next(err);

      res.send(rows);

    })
  })
  
}