// requires
var express = require('express')
var app = express()
var fs = require('fs');
var path = require('path');
var mysql = require('mysql')

// get process arguments
var args = process.argv.slice(2);


// set the port
var PORT = 7777;
for (var i = 0; i < args.length; i++) {
    if (args[i] === "-p") {
        if (++i < args.length) PORT = args[i];
        console.log(PORT);
        break;
    }
}

// set the app path
var PATH = '/dev/index_RequireJS_no-optimize.html';
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


// authenticate
var bookIds = [1,2,3];

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

  res.send(req.params)
})

// read.biblemesh.com/users/{user_id}/books/{book_id}.json
app.all('/users/:userId/books/:bookId.json', function (req, res, next) {
  
  if(req.method == 'PATCH') {

    containedOldPatch = false;

    // A JSON array of user-data book objects is sent to the Readium server,
    // which contains the portions that need to be added, updated or deleted.
    // That is, latest_location is only included if updated and the highlights
    // array should only include added or updated highlights.

    // An updated_at UTC timestamp must be sent with each object in the request
    // (except for those flagged with _delete), so that this timestamp can be
    // checked against the timestamp of that object on the server. The server
    // will only execute the update for that object if the sent object is newer
    // than the object on the server. This check is done on an object-by-object
    // basis, such that some may be updated, some not.

    // To delete a highlight, include an object with start, end and a _delete flag.
    // Eg. {highlights: [{start: xxxx, end: xxxx, _delete: true}]}


    if(containedOldPatch) {
      // When one or more object was not updated due to an old updated_at timestamp (i.e. stale data).
      res.status(412);
    } else {
      // When there is success on all objects
      res.send({ success: true });  //status 200
    }

  } else {
    next();
  }
})

// get epub_library.json with library listing for given user
app.get('/epub_content/epub_library.json', function (req, res) {

  // has bookIds array from authenticate

  // look those books up in the database and form the library
  var connection = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'ReadiumData'
  })

  connection.connect(function(err) {
    if (err) throw err
    
    // console.log('Connected to DB')

    connection.query('SELECT * FROM `book` WHERE id IN(?)', [bookIds] , function (err, rows, fields) {
      if (err) throw err

      res.send(rows);
    })

    connection.end()

  })

});

// serve the static files
app.get('*', function (req, res) {
  var urlWithoutQuery = req.url.replace(/(\?.*)?$/, '');
  var urlPieces = urlWithoutQuery.split('/');
  var staticFile = path.join(process.cwd(), urlWithoutQuery);

  if(fs.existsSync(staticFile)) {

    var bookId = parseInt((urlPieces[2] || '0').replace(/^book_([0-9]+).*$/, '$1'));

    // check that they have access if this is a book
    if(urlPieces[1] == 'epub_content' && bookIds.indexOf(bookId) == -1) {
        res.status(403).send({ error: 'Forbidden' });
    } else {
        res.sendFile(staticFile, {
            dotfiles: "allow"
        })
    }
  } else {
    // console.log('File not found: ' + staticFile);
    res.status(404).send({ error: 'Not found' });
  }
})

// catch all else
app.all('*', function (req, res) {
  res.status(404).send({ error: 'Invalid request' });
});

app.listen(PORT, function () {
  console.log('Listening on port ' + PORT + '!')
})
