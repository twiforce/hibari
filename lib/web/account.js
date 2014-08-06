/**
 * web/account.js - Webserver details for account management
 *
 * @author Calvin Montgomery <cyzon@cyzon.us>
 */

var webserver = require("./webserver");
var logRequest = webserver.logRequest;
var sendJade = require("./jade").sendJade;
var Logger = require("../logger");
var db = require("../database");
var $util = require("../utilities");
var Config = require("../config");
var Server = require("../server");

/**
 * Handles a GET request for /account/edit
 */
function handleAccountEditPage(req, res) {
    if (webserver.redirectHttps(req, res)) {
        return;
    }

    logRequest(req);

    sendJade(res, "account-edit", req.locals);
}

/**
 * Handles a POST request to edit a user"s account
 */
function handleAccountEdit(req, res) {
    logRequest(req);
    var action = req.body.action;
    switch(action) {
        case "change_password":
            handleChangePassword(req, res);
            break;
        case "change_email":
            handleChangeEmail(req, res);
            break;
        default:
            res.send(400);
            break;
    }
}

/**
 * Handles a request to change the user"s password
 */
function handleChangePassword(req, res) {
    var name = req.body.name;
    var oldpassword = req.body.oldpassword;
    var newpassword = req.body.newpassword;

    if (typeof name !== "string" ||
        typeof oldpassword !== "string" ||
        typeof newpassword !== "string") {
        res.send(400);
        return;
    }

    if (newpassword.length === 0) {
        req.locals.errorMessage = "New password must not be empty";
        sendJade(res, "account-edit", req.locals);
        return;
    }

    newpassword = newpassword.substring(0, 100);

    db.users.verifyLogin(name, oldpassword, function (err, user) {
        if (err) {
            req.locals.errorMessage = err;
            sendJade(res, "account-edit", req.locals);
            return;
        }

        db.users.setPassword(name, newpassword, function (err, dbres) {
            if (err) {
                req.locals.errorMessage = err;
                sendJade(res, "account-edit", req.locals);
                return;
            }

            Logger.eventlog.log("[account] " + webserver.ipForRequest(req) +
                                " changed password for " + name);
            req.locals.successMessage = "Password changed.";
            sendJade(res, "account-edit", req.locals);
        });
    });
}

/**
 * Handles a request to change the user"s email
 */
function handleChangeEmail(req, res) {
    var name = req.body.name;
    var password = req.body.password;
    var email = req.body.email;

    if (typeof name !== "string" ||
        typeof password !== "string" ||
        typeof email !== "string") {
        res.send(400);
        return;
    }

    if (!$util.isValidEmail(email) && email !== "") {
        req.locals.errorMessage = "Invalid email address";
        sendJade(res, "account-edit", req.locals);
        return;
    }

    db.users.verifyLogin(name, password, function (err, user) {
        if (err) {
            req.locals.errorMessage = err;
            sendJade(res, "account-edit", req.locals);
            return;
        }

        db.users.setEmail(name, email, function (err, dbres) {
            if (err) {
                req.locals.errorMessage = err;
                sendJade(res, "account-edit", req.locals);
                return;
            }

            Logger.eventlog.log("[account] " + webserver.ipForRequest(req) +
                                " changed email for " + name +
                                " to " + email);

            req.locals.successMessage = "Email address changed.";
            sendJade(res, "account-edit", req.locals);
        });
    });
}

/**
 * Handles a GET request for /account/channels
 */
function handleAccountChannelPage(req, res) {
    if (webserver.redirectHttps(req, res)) {
        return;
    }

    logRequest(req);

    if (req.user) {
        db.channels.listUserChannels(req.user.name, function (err, channels) {
            req.locals.channels = channels;
            sendJade(res, "account-channels", req.locals);
        });
    } else {
        req.locals.channels = [];
        sendJade(res, "account-channels", req.locals);
    }
}

/**
 * Handles a POST request to modify a user"s channels
 */
function handleAccountChannel(req, res) {
    logRequest(req);
    var action = req.body.action;
    switch(action) {
        case "new_channel":
            handleNewChannel(req, res);
            break;
        case "delete_channel":
            handleDeleteChannel(req, res);
            break;
        default:
            res.send(400);
            break;
    }
}

/**
 * Handles a request to register a new channel
 */
function handleNewChannel(req, res) {
    logRequest(req);

    var name = req.body.name;
    if (typeof name !== "string") {
        res.send(400);
        return;
    }

    req.locals.channels = [];

    if (!req.user) {
        sendJade(res, "account-channels", req.locals);
        return;
    }

    db.channels.listUserChannels(req.user.name, function (err, channels) {
        if (err) {
            req.locals.newChannelError = err;
            sendJade(res, "account-channels", req.locals);
            return;
        }

        if (name.match(Config.get("reserved-names.channels"))) {
            req.locals.newChannelError = "That channel name is reserved";
            sendJade(res, "account-channels", req.locals);
            return;
        }

        if (channels.length >= Config.get("max-channels-per-user")) {
            req.locals.newChannelError = "You are not allowed to register more than " +
                                         Config.get("max-channels-per-user") + " channels.";
            sendJade(res, "account-channels", req.locals);
            return;
        }

        db.channels.register(name, req.user.name, function (err, channel) {
            if (!err) {
                Logger.eventlog.log("[channel] " + req.user.name + "@" +
                                    webserver.ipForRequest(req) +
                                    " registered channel " + name);
                var sv = Server.getServer();
                if (sv.isChannelLoaded(name)) {
                    var chan = sv.getChannel(name);
                    var users = Array.prototype.slice.call(chan.users);
                    users.forEach(function (u) {
                        u.kick("Channel reloading");
                    });

                    if (!chan.dead) {
                        chan.emit("empty");
                    }
                }
                channels.push({
                    name: name
                });
            }

            req.locals.channels = channels;
            if (err) {
                req.locals.newChannelError = err;
            }

            sendJade(res, "account-channels", req.locals);
        });
    });
}

/**
 * Handles a request to delete a new channel
 */
function handleDeleteChannel(req, res) {
    logRequest(req);

    var name = req.body.name;
    if (typeof name !== "string") {
        res.send(400);
        return;
    }

    req.locals.channels = [];

    if (!req.user) {
        sendJade(res, "account-channels", req.locals);
        return;
    }

    var user = req.user;

    db.channels.lookup(name, function (err, channel) {
        if (err) {
            req.locals.deleteChannelError = err;
            sendJade(res, "account-channels", req.locals);
            return;
        }

        if (channel.owner !== user.name && user.global_rank < 255) {
            db.channels.listUserChannels(user.name, function (err2, channels) {
                req.locals.deleteChannelError = "You do not have permission to delete " +
                                                "this channel";
                req.locals.channels = err2 ? [] : channels;
                sendJade(res, "account-channels", req.locals);
            });
            return;
        }

        db.channels.drop(name, function (err) {
            if (!err) {
                Logger.eventlog.log("[channel] " + user.name + "@" +
                                    webserver.ipForRequest(req) + " deleted channel " +
                                    name);
                var sv = Server.getServer();
                if (sv.isChannelLoaded(name)) {
                    var chan = sv.getChannel(name);
                    chan.clearFlag(require("../flags").C_REGISTERED);
                    var users = Array.prototype.slice.call(chan.users);
                    users.forEach(function (u) {
                        u.kick("Channel reloading");
                    });

                    if (!chan.dead) {
                        chan.emit("empty");
                    }
                }
            }

            req.locals.deleteChannelError = err;

            db.channels.listUserChannels(user.name, function (err2, channels) {
                req.locals.channels = err2 ? [] : channels;
                sendJade(res, "account-channels", req.locals);
            });
        });
    });
}

/**
 * Handles a GET request for /account/profile
 */
function handleAccountProfilePage(req, res) {
    if (webserver.redirectHttps(req, res)) {
        return;
    }

    logRequest(req);
    
    req.locals.profileImage = "";
    req.locals.profileText = "";

    if (!req.user) {
        sendJade(res, "account-profile", req.locals);
        return;
    }

    db.users.getProfile(req.user.name, function (err, profile) {
        if (err) {
            req.locals.profileError = err;
            sendJade(res, "account-profile", req.locals);
            return;
        }

        req.locals.profileImage = profile.image;
        req.locals.profileText = profile.text;

        sendJade(res, "account-profile", req.locals);
    });
}

/**
 * Handles a POST request to edit a profile
 */
function handleAccountProfile(req, res) {
    logRequest(req);

    req.locals.profileImage = "";
    req.locals.profileText = "";

    if (!req.user) {
        req.locals.profileError = "You must be logged in to edit your profile";
        sendJade(res, "account-profile", req.locals);
    }

    var image = req.body.image;
    var text = req.body.text;

    db.users.setProfile(req.user.name, { image: image, text: text }, function (err) {
        if (err) {
            req.locals.profileError = err;
        } else {
            req.locals.profileImage = image;
            req.locals.profileText = text;
        }

        sendJade(res, "account-profile", req.locals);
    });
}

/**
 * Handles a GET request for /account/passwordreset
 */
function handlePasswordResetPage(req, res) {
    if (webserver.redirectHttps(req, res)) {
        return;
    }

    logRequest(req);

    req.locals.reset = false;
    req.locals.resetEmail = "";
    req.locals.resetErr = false;

    sendJade(res, "account-passwordreset", req.locals);
}

/**
 * Handles a POST request to reset a user's password
 */
function handlePasswordReset(req, res) {
    logRequest(req);

    var name = req.body.name,
        email = req.body.email;

    if (typeof name !== "string" || typeof email !== "string") {
        res.send(400);
        return;
    }

    req.locals.reset = false;
    req.locals.resetEmail = "";

    if (!$util.isValidUserName(name)) {
        req.locals.resetErr = "Invalid username '" + name + "'";
        sendJade(res, "account-passwordreset", req.locals);
        return;
    }

    db.users.getEmail(name, function (err, actualEmail) {
        if (err) {
            req.locals.resetErr = err;
            sendJade(res, "account-passwordreset", req.locals);
            return;
        }

        if (actualEmail !== email.trim()) {
            req.locals.resetErr = "Provided email does not match the email address on " +
                                  "record for " + name;
            sendJade(res, "account-passwordreset", req.locals);
            return;
        } else if (actualEmail === "") {
            req.locals.resetErr = name + " doesn't have an email address on record.  " +
                                  "Please contact an administrator to manually reset " +
                                  "your password.";
            sendJade(res, "account-passwordreset", req.locals);
            return;
        }

        var hash = $util.sha1($util.randomSalt(64));
        // 24-hour expiration
        var expire = Date.now() + 86400000;
        var ip = webserver.ipForRequest(req);

        db.addPasswordReset({
            ip: ip,
            name: name,
            email: email,
            hash: hash,
            expire: expire
        }, function (err, dbres) {
            if (err) {
                req.locals.resetErr = err;
                sendJade(res, "account-passwordreset", req.locals);
                return;
            }

            Logger.eventlog.log("[account] " + ip + " requested password recovery for " +
                                name + " <" + email + ">");
            req.locals.resetEmail = email;

            if (!Config.get("mail.enabled")) {
                req.locals.resetErr = "This server does not have mail support enabled.  " +
                                      "Please contact an administrator for assistance.";
                sendJade(res, "account-passwordreset", req.locals);
                return;
            }

            var msg = "A password reset request was issued for your " +
                      "account `"+ name + "` on " + Config.get("http.domain") +
                      ".  This request is valid for 24 hours.  If you did "+
                      "not initiate this, there is no need to take action."+
                      "  To reset your password, copy and paste the " +
                      "following link into your browser: " +
                      Config.get("http.domain") + "/account/passwordrecover/"+hash;

            var mail = {
                from: "CyTube Services <" + Config.get("mail.from") + ">",
                to: email,
                subject: "Password reset request",
                text: msg
            };

            Config.get("mail.nodemailer").sendMail(mail, function (err, response) {
                if (err) {
                    Logger.errlog.log("mail fail: " + err);
                    req.locals.resetErr = "Sending reset email failed.  Please contact " +
                                          "an administrator for assistance.";
                } else {
                    req.locals.reset = true;
                }
                sendJade(res, "account-passwordreset", req.locals);
            });
        });
    });
}

/**
 * Handles a request for /account/passwordrecover/<hash>
 */
function handlePasswordRecover(req, res) {
    logRequest(req);

    var hash = req.params.hash;
    if (typeof hash !== "string") {
        res.send(400);
        return;
    }

    var ip = webserver.ipForRequest(req);
    req.locals.recovered = false;

    db.lookupPasswordReset(hash, function (err, row) {
        if (err) {
            req.locals.recoverErr = err;
            sendJade(res, "account-passwordrecover", req.locals);
            return;
        }

        if (Date.now() >= row.expire) {
            req.locals.recoverErr = "This password recovery link has expired.  Password " +
                                    "recovery links are only valid for 24 hours after " +
                                    "submission.";
            sendJade(res, "account-passwordrecover", req.locals);
            return;
        }

        var newpw = "";
        const avail = "abcdefgihkmnpqrstuvwxyz0123456789";
        for (var i = 0; i < 10; i++) {
            newpw += avail[Math.floor(Math.random() * avail.length)];
        }
        db.users.setPassword(row.name, newpw, function (err) {
            if (err) {
                req.locals.recoverErr = "Database error.  Please contact an " +
                                        "administrator if this persists.";
                sendJade(res, "account-passwordrecover", req.locals);
                return;
            }

            db.deletePasswordReset(hash);
            Logger.eventlog.log("[account] " + ip + " recovered password for " + row.name);

            req.locals.recovered = true;
            req.locals.recoverPw = newpw;
            sendJade(res, "account-passwordrecover", req.locals);
        });
    });
}

module.exports = {
    /**
     * Initialize the module
     */
    init: function (app) {
        app.get("/account/edit", handleAccountEditPage);
        app.post("/account/edit", handleAccountEdit);
        app.get("/account/channels", handleAccountChannelPage);
        app.post("/account/channels", handleAccountChannel);
        app.get("/account/profile", handleAccountProfilePage);
        app.post("/account/profile", handleAccountProfile);
        app.get("/account/passwordreset", handlePasswordResetPage);
        app.post("/account/passwordreset", handlePasswordReset);
        app.get("/account/passwordrecover/:hash", handlePasswordRecover);
        app.get("/account", function (req, res) {
            res.redirect("/login");
        });
    }
};
