/* ডেটা: শুধু backend (Adhar API, SQLite)-এ থাকে। ব্রাউজারে ডেটা জমা হয় না, শুধু পেজ খোলা থাকা পর্যন্ত মেমোরিতে থাকে।
   token আর থিম ছাড়া localStorage-এ কিছু রাখা হয় না। */
(function (P) {
    var TOKEN_KEY = 'phd:token';
    // আগের সংস্করণের জমে থাকা ডেটার কপি; এখন আর দরকার নেই
    var OLD_KEYS = ['phd:data:v1', 'phd:undo:v1', 'phd:broken'];
    var state = null;
    var undoState = null;
    var ready = null;
    var queue = Promise.resolve();

    function read(key) {
        try {
            return localStorage.getItem(key);
        } catch (e) {
            return null;
        }
    }

    function write(key, value) {
        try {
            localStorage.setItem(key, value);
        } catch (e) {
            /* ব্রাউজার জায়গা না দিলে token সেভ হবে না; পেজে আবার টোকেন দিতে হবে */
        }
    }

    function remove(key) {
        try {
            localStorage.removeItem(key);
        } catch (e) {
            /* কিছু করার নেই */
        }
    }

    OLD_KEYS.forEach(remove);

    function emit(source) {
        if (typeof document === 'undefined') return;
        document.dispatchEvent(new CustomEvent('phd:change', { detail: { source: source } }));
    }

    function notify(message, status) {
        if (P.ui) P.ui.toast(message, status);
    }

    // চলমান সার্ভার কলের সংখ্যা; ১টাও থাকলে পুরো পর্দা আটকে লোডার দেখায় (layout.alo-র #api-loader, একটা modal dialog)।
    // modal বলে খোলা ড্রয়ার বা ডায়ালগের উপরেও থাকে, আর কাজ শেষ না হওয়া পর্যন্ত আর কিছু চাপা যায় না।
    // লোডার অন্তত MIN_SHOW মিলিসেকেন্ড দেখানো হয়, যাতে দ্রুত শেষ হলেও চোখে পড়ে।
    var MIN_SHOW = 700;
    var pending = 0;
    var shownAt = 0;
    var hideTimer = null;
    function busy(delta) {
        pending = Math.max(0, pending + delta);
        var el = typeof document !== 'undefined' && document.getElementById('api-loader');
        if (!el || !el.showModal) return;
        if (!el.dataset.bound) {
            el.dataset.bound = '1';
            // Esc চাপলে বন্ধ হবে না; তবু বন্ধ হয়ে গেলে কাজ চলা পর্যন্ত আবার খোলে
            el.addEventListener('cancel', function (e) {
                e.preventDefault();
            });
            el.addEventListener('close', function () {
                if (pending > 0) el.showModal();
            });
        }
        clearTimeout(hideTimer);
        if (pending > 0) {
            // প্রথমবার ডেটা আনার সময় #boot-ই দেখায়, তাই তখন লোডার লাগে না
            if (state && !el.open) {
                shownAt = Date.now();
                el.showModal();
            }
            return;
        }
        var wait = Math.max(0, MIN_SHOW - (Date.now() - shownAt));
        hideTimer = setTimeout(function () {
            if (pending === 0 && el.open) el.close();
        }, wait);
    }

    // সেভ চলার সময় পেজ বন্ধ বা reload করতে গেলে ব্রাউজার আগে জিজ্ঞেস করে, নইলে বদল হারিয়ে যায়
    var saving = 0;
    if (typeof window !== 'undefined') {
        window.addEventListener('beforeunload', function (e) {
            if (saving > 0) e.preventDefault();
        });
    }

    // প্রথমবার ডেটা আসার আগে পুরো পেজে "ডেটা আনা হচ্ছে" দেখায় (layout.alo-র #boot)
    function hideBoot() {
        var el = typeof document !== 'undefined' && document.getElementById('boot');
        if (el) el.hidden = true;
    }

    // সার্ভার না পেলে পেজের উপরে একটা বার্তা, আর আবার চেষ্টার বাটন (অবস্থা: layout.alo-র #server-status)
    function showOffline(message) {
        var el = typeof document !== 'undefined' && document.getElementById('server-status');
        if (!el) return;
        el.querySelector('[data-status-text]').textContent = message;
        el.hidden = false;
    }

    function hideOffline() {
        var el = typeof document !== 'undefined' && document.getElementById('server-status');
        if (el) el.hidden = true;
    }

    // সার্ভারে পুরো ডেটা পাঠানো, একটার পর একটা। প্রতিবার তখনকার পুরো ডেটা যায়।
    // ব্যর্থ হলে সার্ভার থেকে আবার আনা হয়, যাতে স্ক্রিন যা দেখায় তা সার্ভারের সাথে মেলে।
    // queue শেষে true দেয় সেভ হলে, false দেয় না হলে; কখনো reject হয় না।
    function push() {
        saving += 1;
        queue = queue
            .then(function () {
                return P.api.request('PUT', '/api/data', P.exportData(state));
            })
            .then(
                function () {
                    hideOffline();
                    return true;
                },
                function (err) {
                    if (err.unauthorized) {
                        P.api.logout();
                        return false;
                    }
                    notify('সার্ভারে সেভ হয়নি: ' + err.message, 'eol');
                    return P.store.pull().then(
                        function () {
                            return false;
                        },
                        function (e) {
                            showOffline(e.message);
                            return false;
                        }
                    );
                }
            )
            .then(function (ok) {
                saving -= 1;
                return ok;
            });
    }

    P.api = {
        token: function () {
            return read(TOKEN_KEY) || '';
        },

        setToken: function (value) {
            if (value) write(TOKEN_KEY, value);
            else remove(TOKEN_KEY);
        },

        // লগআউট: শুধু টোকেন মুছে প্রবেশ পেজে যায়। ডেটা ব্রাউজারে থাকে না, তাই আর কিছু মুছতে হয় না।
        logout: function () {
            remove(TOKEN_KEY);
            location.replace(P.url('/token/'));
        },

        // ফেরত দেয় JSON; সার্ভার ভুল দিলে error.message সহ throw করে। টোকেন ভুল হলে error.unauthorized = true
        send: function (method, path, body) {
            var headers = { Authorization: 'Bearer ' + P.api.token() };
            var init = { method: method, headers: headers };
            if (body !== undefined) {
                headers['Content-Type'] = 'application/json';
                init.body = JSON.stringify(body);
            }
            return fetch(P.API_URL + path, init)
                .catch(function () {
                    throw new Error('সার্ভারের সাথে যোগাযোগ নেই।');
                })
                .then(function (res) {
                    return res.json().catch(function () {
                        return null;
                    }).then(function (json) {
                        if (res.status === 401) {
                            var denied = new Error('অ্যাডমিন টোকেন মেলেনি।');
                            denied.unauthorized = true;
                            throw denied;
                        }
                        if (!res.ok) throw new Error((json && json.error && json.error.message) || 'HTTP ' + res.status);
                        return json;
                    });
                });
        },

        // সব সার্ভার কল এখান দিয়ে যায়, তাই লোডার সবসময় ঠিক দেখায়
        request: function (method, path, body) {
            busy(1);
            return P.api.send(method, path, body).then(function (json) {
                busy(-1);
                return json;
            }, function (err) {
                busy(-1);
                throw err;
            });
        }
    };

    P.store = {
        // সার্ভার থেকে আনে। ফেরত দেয় নতুন অবস্থা।
        pull: function () {
            return P.api.request('GET', '/api/data').then(function (raw) {
                state = P.stripMeta(P.normalizeData(raw));
                hideOffline();
                hideBoot();
                emit('server');
                return state;
            });
        },

        // প্রথমবার সার্ভার থেকে আনে। না পেলে পেজ খালি থাকে, আর উপরে বার্তা আসে। সেই অবস্থায় বদল সেভ হয় না।
        ready: function () {
            if (ready) return ready;
            ready = P.store.pull().catch(function (err) {
                ready = null;
                if (err.unauthorized) return P.api.logout();
                showOffline(err.message);
                hideBoot();
                throw err;
            });
            return ready;
        },

        get: function () {
            return state;
        },

        // সার্ভারে সেভ চলছে কি না
        saving: function () {
            return saving > 0;
        },

        // চলমান সেভ শেষ হলে resolve হয়: true মানে সার্ভারে সেভ হয়েছে
        saved: function () {
            return saving > 0 ? queue : Promise.resolve(true);
        },

        // পুরো ডেটা বদল: মেমোরিতে বদলায় আর সার্ভারে পাঠানো হয়। সার্ভার না থাকলে বদল হয় না।
        save: function (next, source) {
            if (!state) {
                notify('সার্ভারের সাথে যোগাযোগ নেই, তাই বদল সেভ হয়নি।', 'eol');
                return false;
            }
            state = P.stripMeta(P.normalizeData(P.stripMeta(next)));
            push();
            emit(source || 'save');
            return true;
        },

        update: function (fn, source) {
            if (!state) return P.store.save(null, source);
            var next = P.clone(state);
            fn(next);
            return P.store.save(next, source);
        },

        // endoflife.date থেকে সব প্রোডাক্টের তারিখ সার্ভার হালনাগাদ করে; তারপর নতুন অবস্থা টানে
        refreshCatalog: function () {
            return P.api.request('POST', '/api/catalog/refresh').then(function (res) {
                return P.store.pull().then(function () {
                    return res;
                });
            });
        },

        // বড় বদলের আগে আগের অবস্থা রেখে দেওয়া, যাতে এক ক্লিকে ফেরা যায় (শুধু এই পেজ খোলা থাকা পর্যন্ত)
        snapshot: function (label) {
            undoState = state ? { label: label, at: new Date().toISOString(), data: P.clone(state) } : null;
        },

        undoInfo: function () {
            return undoState ? { label: undoState.label, at: undoState.at } : null;
        },

        undo: function () {
            if (!undoState) return false;
            var data = undoState.data;
            undoState = null;
            return P.store.save(data, 'undo');
        },

        // বদল করে আগের অবস্থা রেখে দেয়
        apply: function (next, label) {
            P.store.snapshot(label);
            return P.store.save(next, 'apply');
        }
    };
})(PHD);
