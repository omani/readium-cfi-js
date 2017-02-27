module.exports = function (app, passport, authFuncs, ensureAuthenticated, log) {

  var fs = require('fs');

  app.get('/login',
    function (req, res) {
      // In the future, this will send a page to the user where they can choose the IDP to login with

      // IMPORTANT: When we move to multiple IDPs, I should probably add a `uploaded_by` field to the `book` table
      // to only allow admins from that same IDP to delete that book. OR, have a different environment variable
      // for super admins who can delete books.

      log('Redirect to IDP login');
      res.redirect('/login/bm');

    }
  );

  app.get('/login/:idpCode',
    function(req, res, next) {
      log('Authenticate user', 2);
      passport.authenticate(req.params.idpCode, { failureRedirect: '/login/fail' })(req, res, next);
    },
    function (req, res) {
      res.redirect('/');
    }
  );

  app.post('/login/:idpCode/callback',
    function(req, res, next) {
      log('Authenticate user (callback)', 2);
      passport.authenticate(req.params.idpCode, { failureRedirect: '/login/fail' })(req, res, next);
    },
    function(req, res) {
      var loginRedirect = req.session.loginRedirect || '/';
      delete req.session.loginRedirect;
      log(['Post login redirect', loginRedirect]);
      res.redirect(loginRedirect);
    }
  );

  app.get('/login/fail', 
    function(req, res) {
      log('Report login failure');
      res.status(401).send('Login failed');
    }
  );

  app.get('/logout',
    ensureAuthenticated,
    function (req, res, next) {
      authFuncs[req.user.idpCode].logout(req, res, next);
    }
  );

  app.all('/logout/callback',
    function (req, res) {
      log('Logout callback (will delete cookie)', 2);
      req.logout();
      if(req.query.noredirect) {
        res.send({ success: true });
      } else {
        res.redirect('/');
      }
    }
  );

  app.get('/Shibboleth.sso/:idpCode/Metadata', 
    function(req, res) {
      log('Metadata request');
      res.type('application/xml');
      res.status(200).send(
        authFuncs[req.params.idpCode].getMetaData()
      );
    }
  );

}