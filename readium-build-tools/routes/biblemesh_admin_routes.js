module.exports = function (app, s3, connection, ensureAuthenticated) {

  var path = require('path');
  var fs = require('fs');
  var multiparty = require('multiparty');
  var admzip = require('adm-zip');
  var biblemesh_util = require('./biblemesh_util');

  var deleteFolderRecursive = function(path) {
    if( fs.existsSync(path) ) {
      fs.readdirSync(path).forEach(function(file,index){
        var curPath = path + "/" + file;
        if(fs.lstatSync(curPath).isDirectory()) { // recurse
          deleteFolderRecursive(curPath);
        } else { // delete file
          fs.unlinkSync(curPath);
        }
      });
      fs.rmdirSync(path);
    }
  };


  function emptyS3Folder(params, callback){
    s3.listObjects(params, function(err, data) {
      if (err) return callback(err);

      if (data.Contents.length == 0) callback();

      var delParams = {Bucket: params.Bucket};
      delParams.Delete = {Objects:[]};

      var overfull = data.Contents.length >= 1000;
      data.Contents.slice(0,999).forEach(function(content) {
        delParams.Delete.Objects.push({Key: content.Key});
      });

      if(delParams.Delete.Objects.length > 0) {
        s3.deleteObjects(delParams, function(err, data) {
          if (err) return callback(err);
          if(overfull) emptyS3Folder(params, callback);
          else callback();
        });
      }
    });
  }

  function deleteBook(bookId, next, callback) {
    connection.query('DELETE FROM `book` WHERE id=?', bookId, function (err, result) {
      if (err) return next(err);

      emptyS3Folder({
        Bucket: process.env.S3_BUCKET,
        Prefix: 'epub_content/book_' + bookId + '/'
      }, function(err, data) {
        if (err) return next(err);
        
        callback();

      });
    });
  }

  // delete a book
  app.delete(['/', '/book/:bookId'], ensureAuthenticated, function (req, res, next) {

    if(!req.user.isAdmin) {
      res.send({ error: "You do not have proper permissions to do this action." });
      return;
    }

    deleteBook(req.params.bookId, next, function() {
      res.send({ success: true });
    });
  })

  // import
  app.post('/importbook.json', ensureAuthenticated, function (req, res, next) {

    if(!req.user.isAdmin) {
      res.send({ error: "You do not have proper permissions to do this action." });
      return;
    }

    var tmpDir = 'tmp_epub_' + biblemesh_util.getUTCTimeStamp();
    var toUploadDir = tmpDir + '/toupload';
    var epubToS3SuccessCount = 0;
    var epubFilePaths = [];
    var bookRow;

    var checkDone = function() {
      if(epubToS3SuccessCount == epubFilePaths.length) {
        // clean up
        deleteFolderRecursive(tmpDir);

        // insert the book row
        bookRow.author = bookRow.creator || bookRow.publisher || '';
        delete bookRow.creator;
        delete bookRow.publisher;
        connection.query('UPDATE `book` SET ? WHERE id=?', [bookRow, bookRow.id], function (err, result) {
          if (err) {
            return next(err);
          }
          
          res.send({
            success: true,
            bookId: bookRow.id
          });
        })

      }
    }
    
    var putEPUBFile = function(relfilepath, body) {
      var key = 'epub_content/book_' + bookRow.id + '/' + relfilepath;
      // console.log('Upload file to S3: ' + key);
      s3.putObject({
        Bucket: process.env.S3_BUCKET,
        Key: key,
        Body: body,
        ContentLength: body.byteCount,
      }, function(err, data) {
        // console.log('Return from S3 file upload. File: ' + key);
        if (err) {
          // clean up
          deleteFolderRecursive(tmpDir);
          return next(err);
        }
        epubToS3SuccessCount++;
        checkDone();
      });
    }

    var getEPUBFilePaths = function(path) {
      if( fs.existsSync(path) ) {
        fs.readdirSync(path).forEach(function(file,index){
          var curPath = path + "/" + file;
          if(fs.lstatSync(curPath).isDirectory()) { // recurse
            getEPUBFilePaths(curPath);
          } else {
            epubFilePaths.push(curPath);
          }
        });
      }
    };

    deleteFolderRecursive(tmpDir);

    fs.mkdir(tmpDir, function(err) {

      var form = new multiparty.Form({
        uploadDir: tmpDir
      });

      var processedOneFile = false;  // at this point, we only allow one upload at a time

      form.on('file', function(name, file) {

        if(processedOneFile) return;
        processedOneFile = true;

        var filename = file.originalFilename;

        if(!filename) {
          deleteFolderRecursive(tmpDir);
          res.send({ error: "Invalid file name." });
          return;
        }

        bookRow = {
          title: 'Unknown',
          author: '',
          updated_at: biblemesh_util.timestampToMySQLDatetime()
        };

        // Put row into book table
        connection.query('INSERT INTO `book` SET ?', [bookRow] , function (err, results) {
          if (err) {
            // clean up
            deleteFolderRecursive(tmpDir);
            return next(err);
          }

          bookRow.id = results.insertId;
          bookRow.rootUrl = 'epub_content/book_' + bookRow.id;

          emptyS3Folder({
            Bucket: process.env.S3_BUCKET,
            Prefix: 'epub_content/book_' + bookRow.id + '/'
          }, function(err, data) {
            if (err) {
              // clean up
              deleteFolderRecursive(tmpDir);
              return next(err);
            }
          
            deleteFolderRecursive(toUploadDir);

            fs.mkdir(toUploadDir, function(err) {
              
              try {
                var zip = new admzip(file.path);
                zip.extractAllTo(toUploadDir);

                fs.rename(file.path, toUploadDir + '/book.epub', function(err) {

                  getEPUBFilePaths(toUploadDir);
                  epubFilePaths.forEach(function(path) {
                    // TODO: Setup search
                    // TODO: make thumbnail smaller
                    // TODO: make fonts public

                    if(path == toUploadDir + '/META-INF/container.xml') {
                      var contents = fs.readFileSync(path, "utf-8");
                      var matches = contents.match(/["']([^"']+\.opf)["']/);
                      if(matches) {
                        var opfContents = fs.readFileSync(toUploadDir + '/' + matches[1], "utf-8");

                        ['title','creator','publisher'].forEach(function(dcTag) {
                          var dcTagRegEx = new RegExp('<dc:' + dcTag + '>([^<]+)</dc:' + dcTag + '>');
                          var opfPathMatches1 = opfContents.match(dcTagRegEx);
                          if(opfPathMatches1) {
                            bookRow[dcTag] = opfPathMatches1[1];
                          }

                        });

                        var opfPathMatches2 = opfContents.match(/<meta ([^>]*)name=["']cover["']([^>]*)\/>/);
                        var metaCover = opfPathMatches2 && opfPathMatches2[1] + opfPathMatches2[2]
                        if(metaCover) {
                          var metaCoverMatches = metaCover.match(/content=["']([^"']+)["']/);
                          if(metaCoverMatches) {
                            var coverItemRegEx = new RegExp('<item ([^>]*)id=["\']' + metaCoverMatches[1] + '["\']([^>]*)\/>');
                            var coverItemMatches = opfContents.match(coverItemRegEx);
                            var coverItem = coverItemMatches && coverItemMatches[1] + coverItemMatches[2];
                            if(coverItem) {
                              var coverItemHrefMatches = coverItem.match(/href=["']([^"']+)["']/);
                              if(coverItemHrefMatches) {
                                bookRow.coverHref = 'epub_content/book_' + bookRow.id + '/' + matches[1].replace(/[^\/]*$/, '') + coverItemHrefMatches[1];
                              }
                            }
                          }
                        }
                      }
                    }

                    putEPUBFile(path.replace(toUploadDir + '/', ''), fs.createReadStream(path));
                  });
                });

              } catch (e) {
                deleteFolderRecursive(tmpDir);
                deleteBook(bookRow.id, next, function() {
                  res.send({ error: "Unable to process this file." });
                });
              }
            });
          });
        })
      });

      form.parse(req);
      
    });
  })



}