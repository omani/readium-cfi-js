////////////// REQUIRES //////////////

var express = require('express');
var app = express();
var http = require('http');
var bodyParser = require('body-parser');
// var cookieParser = require('cookie-parser');
var path = require('path');
var mysql = require('mysql');
var AWS = require('aws-sdk');
var session = require('express-session');
var RedisStore = require('connect-redis')(session);
var passport = require('passport');
var saml = require('passport-saml');
require('dotenv').load();  //loads the local environment
var biblemesh_util = require('./routes/biblemesh_util');


////////////// SETUP SERVER //////////////

var port = parseInt(process.env.PORT, 10) || process.env.PORT || 8080;
app.set('port', port);
var server = http.createServer(app);
var appURL = process.env.APP_URL || "https://read.biblemesh.com";


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


////////////// SETUP PASSPORT //////////////

passport.serializeUser(function(user, done) {
  done(null, user);
});

passport.deserializeUser(function(user, done) {
  done(null, user);
});

var authFuncs = {};

var strategyCallback = function(idp, profile, done) {
  console.log('profile', profile);

  var mail = profile['urn:oid:0.9.2342.19200300.100.1.3'];
  var idpUserId = profile['idpUserId'];
  var givenName = profile['urn:oid:2.5.4.42'] || '';
  var sn = profile['urn:oid:2.5.4.4'] || '';
  var bookIds = profile['bookIds'] ? profile['bookIds'].split(' ') : [];

  if(!mail || !idpUserId) {
    console.log(profile);
    done('Bad login.');
  }

  var completeLogin = function(userId) {
    done(null, Object.assign(profile, {
      id: userId,
      email: mail,
      firstname: givenName,
      lastname: sn,
      bookIds: bookIds,
      isAdmin: process.env.ADMIN_EMAILS.split(' ').indexOf(mail) != -1,
      idpCode: idp.code,
      idpName: idp.name,
      idpLogoSrc: idp.logoSrc
    }));
  }

  connection.query('SELECT id FROM `user` WHERE user_id_from_idp=? AND idp_code=?',
    [idpUserId, idp.code],
    function (err, rows) {
      if (err) return done(err);

      var currentMySQLDatetime = biblemesh_util.timestampToMySQLDatetime();

      if(rows.length == 0) {
        connection.query('INSERT into `user` SET ?',
          {
            user_id_from_idp: idpUserId,
            idp_code: idp.code,
            email: mail,
            last_login_at: currentMySQLDatetime
          },
          function (err2, results) {
            if (err2) return done(err2);

            completeLogin(results.insertId);
          }
        );

      } else {
        connection.query('UPDATE `user` SET last_login_at=?, email=? WHERE user_id_from_idp=? AND idp_code=?',
          [currentMySQLDatetime, mail, idpUserId, idp.code],
          function (err2, results) {
            if (err2) return done(err2);

            completeLogin(rows[0].id);
          }
        );
      }

    }
  )
};

// setup SAML strategies for IDPs
connection.query('SELECT * FROM `idp`',
  function (err, rows) {
    if (err) {
      console.log("ERROR: Could not setup IDPs.", err);
      return;
    }

    rows.forEach(function(row) {
      var samlStrategy = new saml.Strategy(
        {
          issuer: appURL + "/shibboleth",
          identifierFormat: null,
          validateInResponseTo: false,
          disableRequestedAuthnContext: true,
          callbackUrl: appURL + "/login/" + row.code + "/callback",
          entryPoint: row.entryPoint,
          logoutUrl: row.logoutUrl,
          logoutCallbackUrl: appURL + "/logout/callback",
          cert: row.idpcert,
          decryptionPvk: row.spkey,
          privateCert: row.spkey
        },
        function(profile, done) {
          strategyCallback(row, profile, done);
        }
      );

      passport.use(row.code, samlStrategy);

      authFuncs[row.code] = {
        getMetaData: function() {
          return samlStrategy.generateServiceProviderMetadata(row.spcert);
        },
        logout: function(req, res, next) {
          if(req.user.nameID && req.user.nameIDFormat) {
            samlStrategy.logout(req, function(err2, req2){
              if (err2) return next(err2);

              //redirect to the IdP Logout URL
              res.redirect(req2);
            });
          } else {
            res.redirect("/logout/callback");
          }
        }
      }

    });
  }
);

function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  } else if (process.env.SKIP_AUTH) {
    req.user = {
      id: 1,
      email: 'place@holder.com',
      firstname: 'Jim',
      lastname: 'Smith',
      bookIds: [],  // ex. [1,2,3]
      isAdmin: true,
      idpCode: 'bm',
      idpName: 'BibleMesh',
      idpLogoSrc: 'https://learn.biblemesh.com/theme/image.php/biblemesh/theme/1487014624/biblemesh-logo-clear'
    }
    return next();
  } else {
    req.session.loginRedirect = req.url;
    if(req.headers['App-Request']) {
      req.session.cookie.maxAge = parseInt(process.env.APP_SESSION_MAXAGE);
    }
    return res.redirect('/login');
  }
}


////////////// MIDDLEWARE //////////////

// see http://stackoverflow.com/questions/14014446/how-to-save-and-retrieve-session-from-redis

// app.use(cookieParser());
app.use(bodyParser.json()); // for parsing application/json
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
  store: new RedisStore(redisOptions),
  secret: process.env.SESSION_SECRET || 'secret',
  saveUninitialized: false,
  resave: false,
  cookie : { httpOnly: true, maxAge: parseInt(process.env.SESSION_MAXAGE) } // configure when sessions expires
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

require('./routes/biblemesh_routes')(app, s3, connection, passport, authFuncs, ensureAuthenticated);


////////////// LISTEN //////////////

server.listen(port);
