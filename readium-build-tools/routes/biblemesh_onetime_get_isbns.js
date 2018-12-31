process.exit(0);

require('dotenv').load();  //loads the local environment
var mysql = require('mysql');
var Entities = require('html-entities').AllHtmlEntities;
var entities = new Entities();
var fs = require('fs');
var AWS = require('aws-sdk');
var s3 = new AWS.S3();

var connection = mysql.createConnection({
    host: process.env.RDS_HOSTNAME,
    port: process.env.RDS_PORT,
    user: process.env.RDS_USERNAME,
    password: process.env.RDS_PASSWORD,
    database: process.env.RDS_DB_NAME,
    multipleStatements: true,
    dateStrings: true
});

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

var queriesToRun = [];
  
connection.query('SELECT * FROM book', function (err, rows) {
    if (err) throw err;

    var rowIndex = 0;

    var doRow = function() {

        var row = rows[rowIndex++];

        if(!row) {
            // finished: do the updates

            console.log('queriesToRun length', queriesToRun.length);

            var runAQuery = function() {
                if(queriesToRun.length > 0) {
                    var query = queriesToRun.shift();
                    connection.query(query.query, query.vars, function (err, result) {
                        if (err) {
                            console.log(query);
                            throw err;
                        }
                        runAQuery();
                    })
                    
                } else {
                    console.log("\n\nDONE");
                    process.exit(0);
                }
            }
        
            runAQuery();
            return;
        }

        console.log(rowIndex + '/' + rows.length);

        if(row.isbn || !row.rootUrl) {
            doRow();
            return;
        }

        s3.getObject({
            Bucket: process.env.S3_BUCKET,
            Key: 'epub_content/book_' + row.id + '/META-INF/container.xml'
        }, function(err, data) {
            if (err) {
                doRow();
                // throw err;
            } else { 
                var contents = data.Body.toString('utf8');
                var matches = (contents || "").match(/["']([^"']+\.opf)["']/);

                s3.getObject({
                    Bucket: process.env.S3_BUCKET,
                    Key: 'epub_content/book_' + row.id + '/' + matches[1]
                }, function(err, data) {
                    if (err) {
                        throw err;
                    } else { 
                        var opfContents = data.Body.toString('utf8');
                        var dcTagRegEx = new RegExp('<dc:identifier[^>]*>([^<]+)</dc:identifier>');
                        var opfPathMatches1 = opfContents.match(dcTagRegEx);
                        if(opfPathMatches1) {
                            var fields = {
                                isbn: entities.decode(opfPathMatches1[1]),
                            }
                            queriesToRun.push({
                                query: 'UPDATE `book` SET ? WHERE id=?',
                                vars: [fields, row.id]
                            })
                        }

                        doRow();
                    }
                });

            }
        });

    }

    doRow();

});
