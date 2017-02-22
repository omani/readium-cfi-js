module.exports = function (app, s3, connection, passport, authFuncs, ensureAuthenticated) {

  var path = require('path');
  var fs = require('fs');
  var mime = require('mime');

  require('./biblemesh_auth_routes')(app, passport, authFuncs, ensureAuthenticated);
  require('./biblemesh_admin_routes')(app, s3, connection, ensureAuthenticated);
  require('./biblemesh_user_routes')(app, connection, ensureAuthenticated);

  var getAssetFromS3 = function(req, res, next) {
    var urlWithoutQuery = req.url.replace(/(\?.*)?$/, '').replace(/^\/book/,'');
    var params = {
      Bucket: process.env.S3_BUCKET,
      Key: urlWithoutQuery.replace(/^\//,'')
    };

    // params.Expires = 60
    // var url = s3.getSignedUrl('getObject', params, function(err, url) {
    //   if(err) {
    //     console.log('S3 getSignedUrl error on ' + params.Key, err);
    //     res.status(404).send({ error: 'Not found' });
    //   } else {
    //     res.redirect(307, url);
    //   }
    // });

    if(req.headers['if-none-match']) {
      params.IfNoneMatch = req.headers['if-none-match'];
    }

    s3.getObject(params, function(err, data) {
      if (err) {
        if (err.statusCode == 304) {
          res.set({
            'ETag': req.headers['if-none-match'],
            'Last-Modified': req.headers['if-modified-since']
          });
          res.status(304);
          res.send();
        } else {
          console.log('S3 file not found: ' + params.Key);
          res.status(404).send({ error: 'Not found' });
        }
      } else { 
        res.set({
          'Last-Modified': data.LastModified,
          'Content-Length': data.ContentLength,
          'Content-Type': mime.lookup(urlWithoutQuery),
          'ETag': data.ETag
        }).send(new Buffer(data.Body));
      }
    });
  }

  // serve the cover images without need of login (since it is used on the sharing page)
  app.get('/epub_content/**', function (req, res, next) {
    var urlWithoutQuery = req.url.replace(/(\?.*)?$/, '').replace(/^\/book/,'');
    var urlPieces = urlWithoutQuery.split('/');
    var bookId = parseInt((urlPieces[2] || '0').replace(/^book_([0-9]+).*$/, '$1'));

    connection.query('SELECT * FROM `book` WHERE id=?',
      [bookId],
      function (err, rows, fields) {
        if (err) return next(err);

        if(rows[0] && rows[0].coverHref == urlWithoutQuery.replace(/^\//,'')) {
          getAssetFromS3(req, res, next);
        } else {
          next();
        }
      }
    );

  })

  // serve the static files
  app.get('*', ensureAuthenticated, function (req, res, next) {
    var urlWithoutQuery = req.url.replace(/(\?.*)?$/, '').replace(/^\/book/,'');
    var urlPieces = urlWithoutQuery.split('/');
    var bookId = parseInt((urlPieces[2] || '0').replace(/^book_([0-9]+).*$/, '$1'));

    // check that they have access if this is a book
    if(urlPieces[1] == 'epub_content') {

      if(!req.user.isAdmin && req.user.bookIds.indexOf(bookId) == -1) {
        res.status(403).send({ error: 'Forbidden' });
      } else {
        getAssetFromS3(req, res, next);
      }

    } else if(process.env.IS_DEV || ['css','fonts','images','scripts'].indexOf(urlPieces[1]) != -1) {

      var staticFile = path.join(process.cwd(), urlWithoutQuery);

      if(fs.existsSync(staticFile)) {
        res.sendFile(staticFile, {
            dotfiles: "allow",
            // cacheControl: false
        });
      } else {
        console.log('File not found: ' + staticFile);
        res.status(404).send({ error: 'Not found' });
      }
        

    } else {
      console.log('Forbidden file or directory: ' + urlPieces[1] + ' - ' + urlWithoutQuery);
      res.status(403).send({ error: 'Forbidden' });
    }
  })

  // catch all else
  app.all('*', function (req, res) {
    console.log('Invalid request', req);
    res.status(404).send({ error: 'Invalid request' });
  })

}