var http = require('http');
var events = require('events');
var _ = require('lodash');

var amfiHost = "portal.amfiindia.com"; //changed on 19 Oct 2013
var amfiPath = "/spages/NAVAll.txt";
var amfiPort = 80;

var lineBuffer = "";

var headers = [];
var types = [];
var managers = [];
var funds = [];
var managerHash = {};
var typesHash = {};
var currTyp, currMgr;
var callback, refreshInterval;

var AMFINavs = function (options) {
	events.EventEmitter.call(this);
	var self = this;
	if (options) {
		if (options.callback)
			callback = options.callback;
		if (options.refreshInterval)
			refreshInterval = options.refreshInterval * 1000;
		if (options.host)
			amfiHost = options.host;
		if (options.path)
			amfiPath = options.path;
		if (options.port)
			amfiPort = options.port;
	}

	acquireData.call(self);
	if (refreshInterval) {
		var int = setInterval(function () {
			acquireData.call(self);
		}, refreshInterval);
	}
}

//inherit events.EventEmitter
AMFINavs.super_ = events.EventEmitter;
AMFINavs.prototype = Object.create(events.EventEmitter.prototype, {
	constructor: {
		value: AMFINavs,
		enumerable: false
	}
});

function acquireData() {
	funds = [];
	types = [];
	managers = [];
	var self = this;
	self.status = 'Acquiring Data from:' + amfiHost + ' on port' + amfiPort;
	console.log(self.status);
	http.request({
		host: amfiHost,
		path: amfiPath,
		port: amfiPort
	}, function (response) {
		var str = '';

		response.on('error', function (chunk) {
			var str;
			str += chunk;
			console.log(str);
		});

		response.on('data', function (chunk) {
			var str;
			str += chunk;
			processData(chunk.toString());
		});

		response.on('end', function () {
			//sort the lists
			managers.sort();
			types.sort();
			//set the data
			self.funds = funds;
			self.fundManagers = managers;
			self.fundTypes = types;
			self.updateDate = new Date();
			self.status = 'Data Ready';
			console.log(self.status);
			//data for callback
			self.data = {
				funds: self.funds,
				fundTypes: self.fundTypes,
				fundManagers: self.fundManagers,
				updateDate: self.updateDate
			}
			//emit event
			self.emit('dataready', self.data);
			//if there is a callback, then do callback
			if (callback)
				callback(self.data);
		});
	}).end();
}

function processData(stringChunk) {
	lineBuffer = lineBuffer + stringChunk; //add chunk to previous incomplete line
	if (stringChunk.lastIndexOf('\r\n') > 0) { //there are multiple lines
		lines = splitTextIntoLines(lineBuffer);
		if (lines) {
			if (lines[lines.length - 1])
				lineBuffer = lines[lines.length - 1]; //assign last line to buffer
			else
				lineBuffer = "";
			lines.forEach(processLine);
		}
	}
}

function processLine(line, idx, lines) {
	if (!line) //if line is null
		return;
	if (idx + 1 == lines.length) //if last line
		return;
	if (headers.length == 0) { //if there are no headers yet, then treat the line as a header
		headers = [];
		processHeader(line);
	} else if (line.indexOf(';') > 0) //if the line has a semi-colon, then this line has func info 
		processFund(line);
	else if (line.indexOf('Ended') > 0) //if the line has a fund type, then it will have 'Ended' text
		processFundType(line);
	else if (line.length > 2) //if line is not any of above but has text, then it is a Fund manager name
		processMgr(line);
}

//process line with column headers
function processHeader(line) {
	headers = line.split(';');
}

//process line with fund type
function processFundType(line) {
	currTyp = line; //next few funds will be of this fund type, so set it as current value
	if (!typesHash[currTyp]) { //making sure types are not duplicated
		types.push(currTyp);
		typesHash[currTyp] = currTyp;
	}
}

//process line with fund manager name
function processMgr(line) {
	currMgr = line; //next few funds will be of this fund manager, so set it as current value
	if (!managerHash[currMgr]) { //making sure fund managers are not duplicated
		managers.push(currMgr);
		managerHash[currMgr] = currMgr;
	}
}

//process line with fund information
function processFund(line) {
	fundVals = line.split(';');
	let fund = {};

	for (i = 0; i < fundVals.length; i++)
		fund[headers[i]] = fundVals[i];

	if (fund['ISIN Div Payout/ ISIN Growth'] != '-') {
		funds.push(processFundSplit(fund, 1));
	}

	if (fund['ISIN Div Reinvestment'] != '-') {
		funds.push(processFundSplit(fund, 2));
	}

}


function processFundSplit(fundObj, checkType) {
	let fund = JSON.parse(JSON.stringify(fundObj));
	let accumulationType = 'Unknown'
	let isin;
	if (checkType == 1) {
		if (_.includes(_.upperCase(fund['Scheme Name']), 'GROWTH')) {
			accumulationType = 'Growth';
		} else if (_.includes(_.upperCase(fund['Scheme Name']), 'DIV') || _.includes(_.upperCase(fund['Scheme Name']), 'BONUS')) {
			accumulationType = 'Dividend'
		} else if (fund['ISIN Div Reinvestment'] != '-') {
			accumulationType = 'Dividend'
		}
		isin = fund['ISIN Div Payout/ ISIN Growth'];
	} else {
		accumulationType = 'Dividend-R';
		isin = fund['ISIN Div Reinvestment'];
	}

	const investmentType = _.includes(_.upperCase(fund['Scheme Name']), 'DIRECT') ? 'Direct' : 'Regular';
	const fundType = _.includes(_.upperCase(currTyp), 'OPEN') ? 'Open ended' : 'Close ended';
	const category = _.split(_.split(currTyp, '(', 2)[1], ')', 1)[0];

	let obj = {};
	obj.code = fund['Scheme Code'];
	obj.ISIN = isin;
	obj.name = fund['Scheme Name'];
	obj.type = fundType;
	obj.category = category;
	obj.fundHouse = currMgr; //add manager to fund information
	obj.investmentType = investmentType;
	obj.accumulationType = accumulationType;
	obj.nav = fund['Net Asset Value'];
	obj.date = fund.Date;
	return obj
}


function splitTextIntoLines(txt) {
	if (txt && txt.length > 0)
		lineArr = txt.split('\r\n');
	return lineArr;
}

module.exports = AMFINavs;