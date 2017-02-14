module.exports = function (app, passport, getAuthStrategyMetaData) {

  var fs = require('fs');

  // Shibboleth
  app.get('/login',
    function (req, res) {
      // In the future, this will send a page to the user where they can choose the IDP to login with

      // IMPORTANT: When we move to multiple IDPs, I should probably add a `uploaded_by` field to the `book` table
      // to only allow admins from that same IDP to delete that book. OR, have a different environment variable
      // for super admins who can delete books.

      res.redirect('/login/bm');
    }
  );

  app.get('/login/:idpCode',
    function(req, res, next) {
      passport.authenticate(req.params.idpCode, { failureRedirect: '/login/fail' })(req, res, next);
    },
    function (req, res) {
      res.redirect('/');
    }
  );

  app.post('/login/:idpCode/callback',
    function(req, res, next) {
      passport.authenticate(req.params.idpCode, { failureRedirect: '/login/fail' })(req, res, next);
    },
    function(req, res) {
      res.redirect('/');
    }
  );

  app.get('/login/fail', 
    function(req, res) {
      res.status(401).send('Login failed');
    }
  );

  app.get('/Shibboleth.sso/:idpCode/Metadata', 
    function(req, res) {
      res.type('application/xml');
      res.status(200).send(
        getAuthStrategyMetaData[req.params.idpCode]()
      );
    }
  );

}