/**
 * web/account.js - Webserver details for account management
 *
 * @author Calvin Montgomery <cyzon@cyzon.us>
 */

var webserver = require("./webserver");
var sendPug = require("./pug").sendPug;
var Logger = require("../logger");
var db = require("../database");
var $util = require("../utilities");
var Config = require("../config");
var Server = require("../server");
var session = require("../session");
var csrf = require("./csrf");
const url = require("url");

const LOGGER = require('@calzoneman/jsli')('database/accounts');

/**
 * Handles a GET request for /account/edit
 */
function handleAccountEditPage(req, res) {
    if (webserver.redirectHttps(req, res)) {
        return;
    }

    sendPug(res, "account-edit", {});
}

/**
 * Handles a POST request to edit a user"s account
 */
function handleAccountEdit(req, res) {
    csrf.verify(req);

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
async function handleChangePassword(req, res) {
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
        sendPug(res, "account-edit", {
            errorMessage: "Новый пароль не должен быть пустым."
        });
        return;
    }

    const reqUser = await webserver.authorize(req);
    if (!reqUser) {
        sendPug(res, "account-edit", {
            errorMessage: "Вы должны авторизоваться для того, чтобы изменить свой пароль."
        });
        return;
    }

    newpassword = newpassword.substring(0, 100);

    db.users.verifyLogin(name, oldpassword, function (err, user) {
        if (err) {
            sendPug(res, "account-edit", {
                errorMessage: err
            });
            return;
        }

        db.users.setPassword(name, newpassword, function (err, dbres) {
            if (err) {
                sendPug(res, "account-edit", {
                    errorMessage: err
                });
                return;
            }

            Logger.eventlog.log("[account] " + req.realIP +
                                " changed password for " + name);

            db.users.getUser(name, function (err, user) {
                if (err) {
                    return sendPug(res, "account-edit", {
                        errorMessage: err
                    });
                }

                var expiration = new Date(parseInt(req.signedCookies.auth.split(":")[1]));
                session.genSession(user, expiration, function (err, auth) {
                    if (err) {
                        return sendPug(res, "account-edit", {
                            errorMessage: err
                        });
                    }

                    webserver.setAuthCookie(req, res, expiration, auth);

                    sendPug(res, "account-edit", {
                        successMessage: "Пароль успешно изменён."
                    });
                });
            });
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
        sendPug(res, "account-edit", {
            errorMessage: "Неверный адрес email"
        });
        return;
    }

    db.users.verifyLogin(name, password, function (err, user) {
        if (err) {
            sendPug(res, "account-edit", {
                errorMessage: err
            });
            return;
        }

        db.users.setEmail(name, email, function (err, dbres) {
            if (err) {
                sendPug(res, "account-edit", {
                    errorMessage: err
                });
                return;
            }
            Logger.eventlog.log("[account] " + req.realIP +
                                " changed email for " + name +
                                " to " + email);
            sendPug(res, "account-edit", {
                successMessage: "Адрес email изменён."
            });
        });
    });
}

/**
 * Handles a GET request for /account/channels
 */
async function handleAccountChannelPage(req, res) {
    if (webserver.redirectHttps(req, res)) {
        return;
    }

    const user = await webserver.authorize(req);
    // TODO: error message
    if (!user) {
        return sendPug(res, "account-channels", {
            channels: []
        });
    }

    db.channels.listUserChannels(user.name, function (err, channels) {
        sendPug(res, "account-channels", {
            channels: channels
        });
    });
}

/**
 * Handles a POST request to modify a user"s channels
 */
function handleAccountChannel(req, res) {
    csrf.verify(req);

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
async function handleNewChannel(req, res) {

    var name = req.body.name;
    if (typeof name !== "string") {
        res.send(400);
        return;
    }

    const user = await webserver.authorize(req);
    // TODO: error message
    if (!user) {
        return sendPug(res, "account-channels", {
            channels: []
        });
    }

    db.channels.listUserChannels(user.name, function (err, channels) {
        if (err) {
            sendPug(res, "account-channels", {
                channels: [],
                newChannelError: err
            });
            return;
        }

        if (name.match(Config.get("reserved-names.channels"))) {
            sendPug(res, "account-channels", {
                channels: channels,
                newChannelError: "Эту комнату сейчас нельзя зарегистрировать."
            });
            return;
        }

        if (channels.length >= Config.get("max-channels-per-user")
                && user.global_rank < 255) {
            sendPug(res, "account-channels", {
                channels: channels,
                newChannelError: "Вам нельзя регистрировать более " +
                                 Config.get("max-channels-per-user") + " комнат."
            });
            return;
        }

        db.channels.register(name, user.name, function (err, channel) {
            if (!err) {
                Logger.eventlog.log("[channel] " + user.name + "@" +
                                    req.realIP +
                                    " registered channel " + name);
                var sv = Server.getServer();
                if (sv.isChannelLoaded(name)) {
                    var chan = sv.getChannel(name);
                    var users = Array.prototype.slice.call(chan.users);
                    users.forEach(function (u) {
                        u.kick("Комната перезагружается");
                    });

                    if (!chan.dead) {
                        chan.emit("empty");
                    }
                }
                channels.push({
                    name: name
                });
            }


            sendPug(res, "account-channels", {
                channels: channels,
                newChannelError: err ? err : undefined
            });
        });
    });
}

/**
 * Handles a request to delete a new channel
 */
async function handleDeleteChannel(req, res) {
    var name = req.body.name;
    if (typeof name !== "string") {
        res.send(400);
        return;
    }

    const user = await webserver.authorize(req);
    // TODO: error
    if (!user) {
        return sendPug(res, "account-channels", {
            channels: [],
        });
    }


    db.channels.lookup(name, function (err, channel) {
        if (err) {
            sendPug(res, "account-channels", {
                channels: [],
                deleteChannelError: err
            });
            return;
        }

        if ((!channel.owner || channel.owner.toLowerCase() !== user.name.toLowerCase()) && user.global_rank < 255) {
            db.channels.listUserChannels(user.name, function (err2, channels) {
                sendPug(res, "account-channels", {
                    channels: err2 ? [] : channels,
                    deleteChannelError: "У вас нет прав для удаления этой комнаты."
                });
            });
            return;
        }

        db.channels.drop(name, function (err) {
            if (!err) {
                Logger.eventlog.log("[channel] " + user.name + "@" +
                                    req.realIP + " deleted channel " +
                                    name);
            }
            var sv = Server.getServer();
            if (sv.isChannelLoaded(name)) {
                var chan = sv.getChannel(name);
                chan.clearFlag(require("../flags").C_REGISTERED);
                var users = Array.prototype.slice.call(chan.users);
                users.forEach(function (u) {
                    u.kick("Комната перезагружается");
                });

                if (!chan.dead) {
                    chan.emit("empty");
                }
            }
            db.channels.listUserChannels(user.name, function (err2, channels) {
                sendPug(res, "account-channels", {
                    channels: err2 ? [] : channels,
                    deleteChannelError: err ? err : undefined
                });
            });
        });
    });
}

/**
 * Handles a GET request for /account/profile
 */
async function handleAccountProfilePage(req, res) {
    if (webserver.redirectHttps(req, res)) {
        return;
    }

    const user = await webserver.authorize(req);
    // TODO: error message
    if (!user) {
        return sendPug(res, "account-profile", {
            profileImage: "",
            profileText: ""
        });
    }

    db.users.getProfile(user.name, function (err, profile) {
        if (err) {
            sendPug(res, "account-profile", {
                profileError: err,
                profileImage: "",
                profileText: ""
            });
            return;
        }

        sendPug(res, "account-profile", {
            profileImage: profile.image,
            profileText: profile.text,
            profileError: false
        });
    });
}

function validateProfileImage(image, callback) {
    var prefix = "Invalid URL for profile image: ";
    var link = image.trim();
    if (!link) {
        process.nextTick(callback, null, link);
    } else {
        var data = url.parse(link);
        if (!data.protocol || data.protocol !== 'https:') {
            process.nextTick(callback,
                    new Error(prefix + " URL must begin with 'https://'"));
        } else if (!data.host) {
            process.nextTick(callback,
                    new Error(prefix + "missing hostname"));
        } else {
            process.nextTick(callback, null, link);
        }
    }
}

/**
 * Handles a POST request to edit a profile
 */
async function handleAccountProfile(req, res) {
    csrf.verify(req);

    const user = await webserver.authorize(req);
    // TODO: error message
    if (!user) {
        return sendPug(res, "account-profile", {
            profileImage: "",
            profileText: "",
            profileError: "Для того, чтобы редактировать свой профиль, вам нужно авторизоваться."
        });
    }

    var rawImage = String(req.body.image).substring(0, 255);
    var text = String(req.body.text).substring(0, 255);

    validateProfileImage(rawImage, (error, image) => {
        if (error) {
            db.users.getProfile(user.name, function (err, profile) {
                var errorMessage = err || error.message;
                sendPug(res, "account-profile", {
                    profileImage: profile ? profile.image : "",
                    profileText: profile ? profile.text : "",
                    profileError: errorMessage
                });
            });
            return;
        }

        db.users.setProfile(user.name, { image: image, text: text }, function (err) {
            if (err) {
                sendPug(res, "account-profile", {
                    profileImage: "",
                    profileText: "",
                    profileError: err
                });
                return;
            }

            sendPug(res, "account-profile", {
                profileImage: image,
                profileText: text,
                profileError: false
            });
        });
    });
}

/**
 * Handles a GET request for /account/passwordreset
 */
function handlePasswordResetPage(req, res) {
    if (webserver.redirectHttps(req, res)) {
        return;
    }

    sendPug(res, "account-passwordreset", {
        reset: false,
        resetEmail: "",
        resetErr: false
    });
}

/**
 * Handles a POST request to reset a user's password
 */
function handlePasswordReset(req, res) {
    csrf.verify(req);

    var name = req.body.name,
        email = req.body.email;

    if (typeof name !== "string" || typeof email !== "string") {
        res.send(400);
        return;
    }

    if (!$util.isValidUserName(name)) {
        sendPug(res, "account-passwordreset", {
            reset: false,
            resetEmail: "",
            resetErr: "Неправильное имя пользователя '" + name + "'"
        });
        return;
    }

    db.users.getEmail(name, function (err, actualEmail) {
        if (err) {
            sendPug(res, "account-passwordreset", {
                reset: false,
                resetEmail: "",
                resetErr: err
            });
            return;
        }

        if (actualEmail !== email.trim()) {
            sendPug(res, "account-passwordreset", {
                reset: false,
                resetEmail: "",
                resetErr: "Введённый email не совпадает с тем, который указан в профиле " + name
            });
            return;
        } else if (actualEmail === "") {
            sendPug(res, "account-passwordreset", {
                reset: false,
                resetEmail: "",
                resetErr: name + " не привязывал email к своей учётной записи. Обратитесь к администратору, " +
                          "чтобы сбросить пароль вручную."
            });
            return;
        }

        var hash = $util.sha1($util.randomSalt(64));
        // 24-hour expiration
        var expire = Date.now() + 86400000;
        var ip = req.realIP;

        db.addPasswordReset({
            ip: ip,
            name: name,
            email: email,
            hash: hash,
            expire: expire
        }, function (err, dbres) {
            if (err) {
                sendPug(res, "account-passwordreset", {
                    reset: false,
                    resetEmail: "",
                    resetErr: err
                });
                return;
            }

            Logger.eventlog.log("[account] " + ip + " requested password recovery for " +
                                name + " <" + email + ">");

            if (!Config.get("mail.enabled")) {
                sendPug(res, "account-passwordreset", {
                    reset: false,
                    resetEmail: email,
                    resetErr: "This server does not have mail support enabled.  Please " +
                              "contact an administrator for assistance."
                });
                return;
            }

            var msg = "Кто-то (надеемся, что это были вы) отправил запрос на" +
                      " изменение пароля для профиля "+ name + ". Если это были не вы, " +
                      "можете проигнорировать это письмо, или даже удалить его. "+
                      "Для того, чтобы изменить пароль на сайте " + Config.get("http.domain") +
                      ", скопируйте и вставьте эту ссылку в адресную строку вашего браузера: " +
                      Config.get("http.domain") + "/account/passwordrecover/"+hash +
                      " — данная ссылка будет действительна 24 часа. ";

            var mail = {
                from: Config.get("mail.from-name") + " <" + Config.get("mail.from-address") + ">",
                to: email,
                subject: "Запрос на изменение пароля",
                text: msg
            };

            Config.get("mail.nodemailer").sendMail(mail, function (err, response) {
                if (err) {
                    LOGGER.error("mail fail: " + err);
                    sendPug(res, "account-passwordreset", {
                        reset: false,
                        resetEmail: email,
                        resetErr: "Sending reset email failed.  Please contact an " +
                                  "administrator for assistance."
                    });
                } else {
                    sendPug(res, "account-passwordreset", {
                        reset: true,
                        resetEmail: email,
                        resetErr: false
                    });
                }
            });
        });
    });
}

/**
 * Handles a request for /account/passwordrecover/<hash>
 */
function handlePasswordRecover(req, res) {
    var hash = req.params.hash;
    if (typeof hash !== "string") {
        res.send(400);
        return;
    }

    var ip = req.realIP;

    db.lookupPasswordReset(hash, function (err, row) {
        if (err) {
            sendPug(res, "account-passwordrecover", {
                recovered: false,
                recoverErr: err
            });
            return;
        }

        if (Date.now() >= row.expire) {
            sendPug(res, "account-passwordrecover", {
                recovered: false,
                recoverErr: "Срок действия ссылки истёк. Пожалуйста, отправьте запрос ещё раз."
            });
            return;
        }

        var newpw = "";
        const avail = "abcdefgihkmnpqrstuvwxyz0123456789";
        for (var i = 0; i < 10; i++) {
            newpw += avail[Math.floor(Math.random() * avail.length)];
        }
        db.users.setPassword(row.name, newpw, function (err) {
            if (err) {
                sendPug(res, "account-passwordrecover", {
                    recovered: false,
                    recoverErr: "Ошибка базы данных. Если эта ошибка повторяется, сообщите " +
                                "администратору."

                });
                return;
            }

            db.deletePasswordReset(hash);
            Logger.eventlog.log("[account] " + ip + " recovered password for " + row.name);

            sendPug(res, "account-passwordrecover", {
                recovered: true,
                recoverPw: newpw
            });
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
