module.exports = function (app, passport) {

  var fs = require('fs');

  // Shibboleth
  app.get('/login',
    passport.authenticate('saml', { failureRedirect: '/login/fail' }),
    function (req, res) {
      res.redirect('/');
    }
  );

  app.post('/login/callback',
    passport.authenticate('saml', { failureRedirect: '/login/fail' }),
    function(req, res) {
      res.redirect('/');
    }
  );

  app.get('/login/fail', 
    function(req, res) {
      res.status(401).send('Login failed');
    }
  );

  app.get('/Shibboleth.sso/Metadata', 
    function(req, res) {
      res.type('application/xml');
      res.status(200).send(samlStrategy.generateServiceProviderMetadata(fs.readFileSync(__dirname + '/cert/cert.pem', 'utf8')));
    }
  );

}