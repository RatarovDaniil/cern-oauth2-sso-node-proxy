const express = require('express');
const passport = require('passport');
const OAuth2Strategy = require('./passport-oauth2');
const app = express();
const http = require('http');
const httpProxy = require('http-proxy');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const request = require('request');
const port = 8080;

const proxy = httpProxy.createProxyServer({});

// This proxy redirects API requests and client side requests

// API requests (GET, POST, PUT, ...):
if (process.env.API_URL) {
    app.all('/api/*', (req, res) => {
        // Remove the API from path
        const new_path = req.url.split('/api')[1];
        req.path = new_path;
        req.url = new_path;
        req.originalUrl = new_path;
        proxy.web(req, res, {
            target: process.env.API_URL
        });
    });
}

app.use(cookieParser());
app.use(bodyParser.json());
app.use(session({ secret: 'cern' }));
app.use(passport.initialize());
app.use(passport.session()); // Used to persist login sessions

passport.use(
    new OAuth2Strategy(
        {
            authorizationURL:
                process.env.authorizationURL ||
                'https://oauth.web.cern.ch/OAuth/Authorize',
            tokenURL:
                process.env.tokenURL || 'https://oauth.web.cern.ch/OAuth/Token',
            clientID: process.env.clientID,
            clientSecret: process.env.clientSecret,
            callbackURL: process.env.callbackURL
        },
        function(accessToken, refreshToken, profile, done) {
            done(null, profile);
        }
    )
);

// Used to stuff a piece of information into a cookie
passport.serializeUser(function(user, done) {
    done(null, user);
});

passport.deserializeUser(function(user, done) {
    done(null, user);
});

// Middleware to check if the user is authenticated
function isUserAuthenticated(req, res, next) {
    if (req.user) {
        next();
    } else {
        res.redirect('/callback');
    }
}

app.get(
    '/callback',
    passport.authenticate('oauth2', {
        failureRedirect: '/error'
    }),
    function(req, res) {
        const { user } = req;

        request('https://test-cms-career.web.cern.ch/api/cms_hr/' + user.id, function (error, response, body) {
            if (!error && response.statusCode == 200) {
                var cms_id = JSON.parse(body)['cms_id'];
                
                if (user.egroups.indexOf('cms-web-access') == -1 && cms_id != 1) {
                    res.clearCookie('connect.sid');
                    res.clearCookie('authenticated');
                    res.clearCookie('cms_id');
                }
                if (cms_id !== '' && cms_id !== null && cms_id !== undefined && (user.egroups.indexOf('cms-web-access') !== -1 || cms_id == 1)) {
                    res.redirect('/user?user=' + cms_id);
                } else {
                    res.redirect('/');
                }
            } else {
                res.redirect('/error');
            }
        })
    }
);

// Logout route
app.get('/logout', (req, res) => {
    req.session.destroy(function() {
        res.clearCookie('connect.sid');
        res.clearCookie('authenticated');
        res.clearCookie('cms_id');
        res.redirect('/');
    });
});
app.get('/error', (req, res) => {
    res.send('Error authenticating user');
});

// Client requests
app.get('/login', isUserAuthenticated, (req, res) => {
    proxy.on('proxyReq', (proxyReq, req, res, options) => {
        const { user } = req;
        if (user) {
            proxyReq.setHeader('displayname', user.displayname);
            proxyReq.setHeader('egroups', user.egroups);
            proxyReq.setHeader('email', user.email);
            proxyReq.setHeader('id', user.id);
            proxyReq.setHeader('authenticated', true);
        } else {
            proxyReq.setHeader('authenticated', false);
        }
    });
    proxy.web(req, res, {
        target: process.env.CLIENT_URL
    });
});

// non Authenticated user
app.all('*', (req, res) => {
    proxy.on('proxyReq', (proxyReq, req, res, options) => {
        const { user } = req;
        if (user) {
            proxyReq.setHeader('displayname', user.displayname);
            proxyReq.setHeader('egroups', user.egroups);
            proxyReq.setHeader('email', user.email);
            proxyReq.setHeader('id', user.id);
            proxyReq.setHeader('authenticated', true);
        } else {
            proxyReq.setHeader('authenticated', false);
        }
    });
    proxy.web(req, res, {
        target: process.env.CLIENT_URL
    });
});

// If something goes wrong on either API or client:
proxy.on('error', function(err, req, res) {
    res.writeHead(500, {
        'Content-Type': 'text/plain'
    });

    res.end(`${err.message} ----------- ${JSON.stringify(err)}`);
});

app.listen(port, () => console.log(`OAUTH Proxy started on port ${port}`));