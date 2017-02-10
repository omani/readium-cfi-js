////////////// REQUIRES //////////////

var express = require('express');
var app = express();
var http = require('http');
var bodyParser = require('body-parser');
// var cookieParser = require('cookie-parser');
var path = require('path');
var fs = require('fs');
var mysql = require('mysql');
var AWS = require('aws-sdk');
var session = require('express-session');
var RedisStore = require('connect-redis')(session);
var passport = require('passport');
var saml = require('passport-saml');
require('dotenv').load();  //loads the local environment


////////////// SETUP SERVER //////////////

var port = parseInt(process.env.PORT, 10) || process.env.PORT || 8080;
app.set('port', port);
var server = http.createServer(app);
var appURL = process.env.APP_URL || "https://read.biblemesh.com";


////////////// SETUP PASSPORT //////////////

passport.serializeUser(function(user, done) {
  done(null, user);
});

passport.deserializeUser(function(user, done) {
  done(null, user);
});

var samlStrategy;
var key = fs.readFileSync(__dirname + '/cert/key.pem', 'utf8');

var strategyOpts = {
  callbackUrl: appURL + "/login/callback",
  issuer: appURL + "/shibboleth",
  identifierFormat: null,
  decryptionPvk: key,
  privateCert: key,
  validateInResponseTo: false,
  disableRequestedAuthnContext: true
};

var strategyCallback = function(profile, done) {
console.log('profile');
console.log(profile);
  return done(null, {
    id: 1,
    bookIds: [],  // ex. [1,2,3]
    isAdmin: true
  }); 
};

var idpData = {
  biblemesh_idp: {
    entryPoint: "https://sandbox.biblemesh.com/idp/profile/SAML2/Redirect/SSO",
    cert: fs.readFileSync(__dirname + '/cert/idp_cert.pem', 'utf8')
  }
};

for(var idp in idpData) {
  samlStrategy = new saml.Strategy(Object.assign(idpData[idp], strategyOpts), strategyCallback);
  passport.use(idp, samlStrategy);
}

function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  } else if (process.env.SKIP_AUTH) {
    req.user = {
      id: 1,
      bookIds: [],  // ex. [1,2,3]
      isAdmin: true
    }
    return next();
  } else {
    return res.redirect('/login');
  }
}


////////////// SETUP STORAGE //////////////

var s3 = new AWS.S3();

var connection = mysql.createConnection({
  host: process.env.RDS_HOSTNAME,
  port: process.env.RDS_PORT,
  user: process.env.RDS_USERNAME,
  password: process.env.RDS_PASSWORD,
  database: process.env.RDS_DB_NAME,
  multipleStatements: true,
  dateStrings: true
})

var redisOptions = {
  host: process.env.REDIS_HOSTNAME,
  port: process.env.REDIS_PORT
}


////////////// MIDDLEWARE //////////////

// see http://stackoverflow.com/questions/14014446/how-to-save-and-retrieve-session-from-redis

// app.use(cookieParser());
app.use(bodyParser.json()); // for parsing application/json
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
  store: new RedisStore(redisOptions),
  secret: process.env.SESSION_SECRET,
  saveUninitialized: false,
  resave: false,
  cookie : { httpOnly: true, maxAge: process.env.SESSION_MAXAGE || 86400000 } // configure when sessions expires
}));
app.use(passport.initialize());
app.use(passport.session());


////////////// ROUTES //////////////

// force HTTPS
app.use('*', function(req, res, next) {  
  if(!req.secure && req.headers['x-forwarded-proto'] !== 'https' && process.env.REQUIRE_HTTPS) {
    var secureUrl = "https://" + req.headers['host'] + req.url; 
    res.redirect(secureUrl);
  } else {
    next();
  }
});

// route RequireJS_config.js properly (for dev)
app.get(['/RequireJS_config.js', '/book/RequireJS_config.js'], function (req, res) {
  res.sendFile(path.join(process.cwd(), 'dev/RequireJS_config.js'));
})

require('./routes/biblemesh_routes')(app, s3, connection, passport, samlStrategy, ensureAuthenticated);


////////////// LISTEN //////////////

server.listen(port);
