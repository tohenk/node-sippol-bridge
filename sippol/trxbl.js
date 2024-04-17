/**
 * The MIT License (MIT)
 *
 * Copyright (c) 2020-2024 Toha <tohenk@yahoo.com>
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

const { Sippol, SippolDataFetcher } = require('.');
const { By } = require('selenium-webdriver');
const Queue = require('@ntlab/work/queue');
const debug = require('debug')('sippol:trxbl');

/**
 * Sippol app to handle `Penatausahaan Pengeluaran`.
 */
class SippolTrxbl extends Sippol {

    configure() {
        this.app = '#/keuda-trxbl';
        this.fetcher = new SippolTrxblDataFetcher(this);
    }

    /**
     * Perform BL data filtering.
     *
     * @param {string} jenis BL type
     * @param {boolean} wait Wait for loader
     * @returns {Promise}
     */
    showData(jenis, wait = true) {
        return this.toolbar.navigateMenuByIcon('fa-table', jenis, {deep: true, wait: wait});
    }

    getRowId(el) {
        return this.works([
            [w => this.getText([By.xpath(`.//td[contains(@title,"Tanggal pengajuan SPJ")]`)], el)],
            [w => Promise.resolve(w.getRes(0)[0].trim())],
        ]);
    }

    retrSpj(el, items) {
        return this.works([
            [w => this.getText([By.xpath('./td[5]')], el)],
            [w => this.retrSpjPackage(el, items), w => w.getRes(0)[0].trim().length],
        ]);
    }

    retrSpjPackage(el, items) {
        return this.works([
            // click spj detail button
            [w => this.click({el: el, data: By.xpath('./td/div/button[@ng-click="vm.kdSpjDetail(kdSpj)"]')})],
            // wait for loader to complete
            [w => this.waitLoader()],
            // wait for modal dialog
            [w => this.waitFor(By.xpath('(//div[contains(@class,"modal")])[1]'))],
            // activate spj
            [w => this.click({el: w.getRes(2), data: By.xpath('.//ul/li/a/uib-tab-heading/span[contains(text(),"Masuk dlm SPJ ini")]/../..')})],
            // wait for loader to complete
            [w => this.waitLoader()],
            // filter Jenis to "Pembayaran Tagihan"
            [w => this.fillFormValue({parent: w.getRes(2), target: By.xpath('.//select[@ng-model="vm.trxSpjIni.fJenis"]'), value: '209'})],
            // apply filter
            [w => this.click({el: w.getRes(2), data: By.xpath('.//button[@ng-click="vm.trxLoadSpj()"]')})],
            // wait for loader to complete
            [w => this.waitLoader()],
            // create data fetcher
            [w => this.createTrxDataFetcher()],
            // add results
            [w => Promise.resolve(items.push(...w.getRes(8))), w => w.getRes(8).length],
            // dimiss modal
            [w => this.click({el: w.getRes(2), data: By.xpath('.//button/span[contains(@class,"glyphicon-ban-circle")]/..')})],
        ]);
    }

    retrSpjTrx(el, items) {
        return this.works([
            // click spj trx button
            [w => this.click({el: el, data: By.xpath('./td/span[@ng-click="vm.trxEdit(trx)"]')})],
            // wait for loader to complete
            [w => this.waitLoader()],
            // retrieve data
            [w => this.getValuesFromTrxForm()],
            // add item
            [w => Promise.resolve(items.push(w.getRes(2))), w => w.getRes(2)],
        ]);
    }

    /**
     * Populate trx data using form values.
     *
     * @returns {Promise}
     */
    getValuesFromTrxForm() {
        return this.works([
            // wait for form to completely shown
            [w => this.waitFor(By.xpath('//form[@name="editForm"]'))],
            // get form title
            [w => this.getText([By.id('myTrxLabel')], w.getRes(0))],
            // get values
            [w => this.getFormValues(w.getRes(0), ['noTrs', 'tglTrs', 'noBukti', '#search_keg_value', 'ket', 'totItem'])],
            // retrieve table rows
            [w => this.findElements({el: w.getRes(0), data: By.xpath('.//table[contains(@class,"jh-table")]/tbody/tr')})],
            [w => new Promise((resolve, reject) => {
                const refs = w.getRes(2);
                const values = {};
                const q = new Queue(w.getRes(3), tr => {
                    this.getText([By.xpath('./td[1]'), By.xpath('./td[2]'), By.xpath('./td[3]')], tr)
                        .then(rvalues => {
                            if (!isNaN(rvalues[0])) {
                                let x = rvalues[1].split(' ', 2);
                                if (x[0] === refs.noTrs) {
                                    x = rvalues[1].split(' ', 2);
                                    values.penerima = rvalues[1].substr(x.join(' ').length).trim();
                                } else {
                                    x = rvalues[1].split(', ', 2);
                                    values.rekening = x[0];
                                }
                            }
                            q.next();
                        })
                        .catch(err => reject(err));
                });
                q.once('done', () => {
                    resolve(values);
                });
            })],
            // dimiss modal
            [w => this.click({el: w.getRes(0), data: By.xpath('//button[@class="close"]')})],
            // parse data
            [w => new Promise((resolve, reject) => {
                const values = Object.assign({}, w.getRes(2), w.getRes(4));
                Object.keys(values).forEach(key => {
                    if (key === 'noTrs') {
                        values[key] = this.pickNumber(values[key]);
                    }
                    if (key === 'totItem') {
                        values[key] = this.pickFloat(values[key]);
                    }
                    const m = key.match(/search_(.*)_value/);
                    if (m) {
                        values[m[1]] = values[key];
                        delete values[key];
                    }
                });
                const data = new SippolTrxData();
                Object.assign(data, values);
                resolve(data);
            })],
        ]);
    }

    createTrxDataFetcher() {
        const fetcher = new SippolSpjDataFetcher(this);
        return fetcher.fetch();
    }
}

class SippolTrxblDataFetcher extends SippolDataFetcher {

    initialize() {
        this.paginator.root = '//div[@class="table-responsive"]/table';
        this.paginator.rowSelector = '/tbody/tr[@ng-repeat]';
    }

    onFetchOptions(options) {
        options.dates = {date: 'tglSpj'};
        options.rowId = el => this.parent.getRowId(el);
    }

    fetchRunWorks(el, items, options) {
        const works = super.fetchRunWorks(el, items, options);
        works.push([x => this.parent.retrSpj(el, items), x => x.res]);
        return works;
    }

    fetchRunMatchSelector(key) {
        return By.xpath(`.//td[contains(@title,"Tanggal pengajuan SPJ")]`);
    }
}

class SippolSpjDataFetcher extends SippolDataFetcher {

    initialize() {
        this.paginator.root = '//div[@id="spjTab"]/div/div[2]/table';
        this.paginator.rowSelector = '/tbody/tr[@ng-repeat]';
    }

    onFetchOptions(options) {
        options.rowId = el => this.parent.works([
            [w => this.parent.getText([By.xpath(`.//td[3]`)], el)],
            [w => Promise.resolve(w.getRes(0)[0].trim())],
        ]);
    }

    fetchRunWorks(el, items, options) {
        const works = super.fetchRunWorks(el, items, options);
        works.push([x => this.parent.retrSpjTrx(el, items), x => x.res]);
        return works;
    }
}

class SippolTrxData {

    copyFrom(data) {
        if (data instanceof SippolTrxData) {
            for (const key in data) {
                this[key] = data[key];
            }
        }
    }
}

module.exports = { SippolTrxbl, SippolTrxData };