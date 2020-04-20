/**
 * The MIT License (MIT)
 *
 * Copyright (c) 2016-2020 Toha <tohenk@yahoo.com>
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of
 * this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
 * of the Software, and to permit persons to whom the Software is furnished to do
 * so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

/*
 * Command line utility
 */

class CmdParser {

    PARAM_VAR = 1
    PARAM_BOOL = 2

    cmds = {}

    register(type, name, shortname, desc, varname, defaultValue) {
        if (!this.cmds[name]) {
            this.cmds[name] = {
                name: name,
                shortname: shortname,
                description: desc,
                type: type || PARAM_BOOL,
                value: defaultValue || null,
                varname: varname || null,
                accessible: true
            }
            this.lastCmd = name;
        }
        return this;
    }

    addBool(name, shortname, desc, defaultValue) {
        return this.register(this.PARAM_BOOL, name, shortname, desc, defaultValue);
    }

    addVar(name, shortname, desc, varname, defaultValue) {
        return this.register(this.PARAM_VAR, name, shortname, desc, varname, defaultValue);
    }

    setAccessible(accessible) {
        if (this.lastCmd && this.cmds[this.lastCmd]) {
            this.cmds[this.lastCmd].accessible = accessible;
        }
        return this;
    }

    get(name) {
        if (this.cmds[name]) {
            return this.cmds[name]['value'];
        }
    }

    has(name) {
        return this.cmds[name] ? true : false;
    }

    hasShort(shortname) {
        for (let name in this.cmds) {
            if (this.cmds[name]['shortname'] == shortname) return name;
        }
    }

    dump() {
        let str, len = 0, _res = [], _cmds = [], _descs = [];
        for (let name in this.cmds) {
            let cmd = this.cmds[name];
            if (!cmd.accessible) continue;
            str = this.cmdstr(cmd, false);
            if (cmd.shortname) {
                str += ', ' + this.cmdstr(cmd, true);
            }
            if (str.length > len) len = str.length;
            _cmds.push(str);
            _descs.push(cmd.description);
        }
        len += 2;
        for (var i = 0; i < _cmds.length; i++) {
            str = _cmds[i];
            if (str.length < len) {
                str += ' '.repeat(len - str.length);
            }
            _res.push(str + _descs[i]);
        }
        return _res.join("\n");
    }

    cmdstr(cmd, shortCmd) {
        var str = shortCmd ? '-' + cmd.shortname : '--' + cmd.name;
        if (cmd.type == this.PARAM_VAR) {
            str += '=' + (cmd.varname ? cmd.varname : cmd.name);
        }
        return str; 
    }

    parse(args) {
        args = args || process.argv.slice(2);
        let err = null;
        while (true) {
            if (!args.length) break;
            let arg = args[0];
            let param = null;
            let value = null;
            let shortparam = false;
            // check for long parameter format
            if ('--' == arg.substr(0, 2)) {
                param = arg.substr(2);
            // check for short parameter format
            } else if ('-' == arg.substr(0, 1)) {
                param = arg.substr(1);
                shortparam = true;
            }
            // not parameter, just give up
            if (!param) break;
            // check for parameter separator
            if (param.indexOf('=') > 0) {
                value = param.substr(param.indexOf('=') + 1);
                param = param.substr(0, param.indexOf('='));
            }
            // try to get the standard parameter name
            if (shortparam) {
                let longname = this.hasShort(param);
                if (longname) param = longname;
            }
            // check the existence of parameter
            if (!this.has(param)) {
                err = 'Unknown argument "' + param + '".';
                break;
            }
            // validate parameter
            if (this.cmds[param]['type'] == this.PARAM_VAR && !value) {
                err = 'Argument "' + param + '" need a value to be assigned.';
                break;
            }
            if (this.cmds[param]['type'] == this.PARAM_BOOL && value) {
                err = 'Argument "' + param + '" doesn\'t accept a value.';
                break;
            }
            // set the value
            this.cmds[param]['value'] = value ? value : true;
            // remove processed parameter
            args = args.slice(1);
        }
        if (err) {
            console.log(err);
            console.log('');
        }
        return err ? false : true;
    }
}

module.exports = new CmdParser();