module.exports = function (app, appPath, s3, connection, passport, ensureAuthenticated) {

  // temporary
  var bookIds = 'admin';  // normal user: [1,2,3]

  var path = require('path');
  var fs = require('fs');

  // require('./biblemesh_auth_routes')(app, passport);
  require('./biblemesh_admin_routes')(app, s3, connection, ensureAuthenticated);
  require('./biblemesh_user_routes')(app, appPath, connection, ensureAuthenticated);

  // serve the static files
  app.get('*', ensureAuthenticated, function (req, res) {
    var urlWithoutQuery = req.url.replace(/(\?.*)?$/, '').replace(/^\/book/,'');
    var urlPieces = urlWithoutQuery.split('/');
    var bookId = parseInt((urlPieces[2] || '0').replace(/^book_([0-9]+).*$/, '$1'));

    // check that they have access if this is a book
    if(urlPieces[1] == 'epub_content') {

      if(bookIds != 'admin' && bookIds.indexOf(bookId) == -1) {
        res.status(403).send({ error: 'Forbidden' });
      } else {
        var params = {
          Bucket: 'biblemesh-readium',
          Key: urlWithoutQuery.replace(/^\//,'')
        };

        params.Expires = 60
        var url = s3.getSignedUrl('getObject', params, function(err, url) {
          if(err) {
            console.log('S3 getSignedUrl error on ' + params.Key, err);
            res.status(404).send({ error: 'Not found' });
          } else {
            res.redirect(307, url);
          }
        });
        
        // s3.getObject(params, function(err, data) {
        //   if (err) {
        //     console.log('S3 file not found: ' + params.Key);
        //     res.status(404).send({ error: 'Not found' });
        //   } else { 
        //     res.set({
        //       LastModified: data.LastModified,
        //       ContentLength: data.ContentLength,
        //       ContentType: data.ContentType,
        //       ETag: data.ETag
        //     }).send(new Buffer(data.Body));
        //   }
        // });
        
      }

    } else if(appPath != '/index.html' || ['css','fonts','images','scripts'].indexOf(urlPieces[1]) != -1) {

      var staticFile = path.join(process.cwd(), urlWithoutQuery);

      if(fs.existsSync(staticFile)) {
        res.sendFile(staticFile, {
            dotfiles: "allow"
        })
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
    res.status(404).send({ error: 'Invalid request' });
  })

}