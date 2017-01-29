// requires
var express = require('express');
var app = express();
var http = require('http');
var bodyParser = require('body-parser');
// var cookieParser = require('cookie-parser');
var path = require('path');
var fs = require('fs');
var mysql = require('mysql');
var AWS = require('aws-sdk');
// var session = require('express-session');
// var RedisStore = require('connect-redis')(session);
var passport = require('passport');
// var saml = require('passport-saml');


//// SETUP SERVER

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
var appPath = '/index.html';
for (var i = 0; i < args.length; i++) {
    if (args[i] === "-OPEN") {
        args.splice(i, 1);
        
        if (i < args.length) {
            appPath = args[i];
            args.splice(i, 1);
        }
        
        console.log(appPath);
        break;
    }
}


//// SETUP PASSPORT

// passport.serializeUser(function(user, done) {
//   done(null, user);
// });

// passport.deserializeUser(function(user, done) {
//   done(null, user);
// });

// var samlStrategy = new saml.Strategy({
//   // URL that goes from the Identity Provider -> Service Provider
//   callbackUrl: "https://read.biblemesh.com/login/callback",
//   // URL that goes from the Service Provider -> Identity Provider
//   entryPoint: "https://sandbox.biblemesh.com/idp/profile/SAML2/Redirect/SSO",
//   issuer: "https://read.biblemesh.com/shibboleth",
//   identifierFormat: null,
//   // Service Provider private key
//   decryptionPvk: fs.readFileSync(__dirname + '/cert/key.pem', 'utf8'),
//   // Service Provider Certificate
//   privateCert: fs.readFileSync(__dirname + '/cert/cert.pem', 'utf8'),
//   // Identity Provider's public key
//   cert: fs.readFileSync(__dirname + '/cert/idp_cert.pem', 'utf8'),
//   validateInResponseTo: false,
//   disableRequestedAuthnContext: true
// }, function(profile, done) {
//   return done(null, profile); 
// });

// passport.use(samlStrategy);

function ensureAuthenticated(req, res, next) {
    return next();

  if (req.isAuthenticated())
    return next();
  else
    return res.redirect('/login');
}


//// SETUP STORAGE

// setup Amazon S3
var s3 = new AWS.S3();

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

// var redisOptions = {
//   port: process.env.REDIS_PORT || '6379',
//   url: process.env.REDIS_URL || 'localhost'
// }


//// MIDDLEWARE

// app.use(cookieParser());
app.use(bodyParser.json()); // for parsing application/json
app.use(bodyParser.urlencoded({ extended: true }));
// app.use(session({
//   store: new RedisStore(redisOptions),
//   secret: process.env.REDIS_SECRET || 'secret',
//   saveUninitialized: false,
//   resave: false,
//   cookie : { httpOnly: true, maxAge: process.env.REDIS_MAXAGE || 86400000 } // configure when sessions expires
// }));
// app.use(passport.initialize());
// app.use(passport.session());


//// ROUTES

// route RequireJS_config.js properly (for dev)
app.get(['/RequireJS_config.js', '/book/RequireJS_config.js'], function (req, res) {
  res.sendFile(path.join(process.cwd(), 'dev/RequireJS_config.js'))
})

require('./routes/biblemesh_routes')(app, appPath, s3, connection, passport, ensureAuthenticated);


//// LISTEN

server.listen(port);
