#!/usr/bin/env node

/*
 * Copyright (c) Sebastian Kucharczyk <kuchen@kekse.biz>
 * https://kekse.biz/
 */

//
import * as globals from '../shared/globals.js';
import * as server from '../shared/server.js';
import getopt from '../shared/getopt.js';
import PDF from '../shared/pdf.js';
import fs from 'node:fs';

//
const syntax = (_code = null, _err = null) => {
	console.debug('todo: syntax()');

	if(_err)
	{
		console.error(EOL +
			_err);
	}

	if(_code !== null)
	{
		process.exit(_code);
	}
};

//
const args = getopt({
	cast: true,
	array: true,
	unescape: true,
	castRegular: true,
	equalAssign: true });
const THROW = (args.has('throw', 'boolean') ?
	args.get('throw') : null);
const docs = [];
var temp;

for(var i = 0, j = 0; i < args.length; ++i)
{
	if(pathname(args[i])) try
	{
		temp = fs.realpathSync(args[i]);

		if(docs.includes(temp))
		{
			console.warn('Path is already selected; no duplicates, please!');
		}
		else
		{
			docs[j++] = temp;
		}
	}
	catch(_err)
	{
		console.warn('Argument `%s` is not a valid path.',
			args[i].error());
	}
}

if(docs.length === 0)
{
	syntax(1, 'No input document(s) defined or remained!');
}

var err = 0; for(var i = 0; i < docs.length; ++i)
{
	const op = docs[i];

	try
	{
		temp = PDF.create({ path: docs[i],
			throw: THROW, argumentThrow: false });
		console.debug('Loaded `%s`.', docs[i].info());
		docs[i] = temp;
	}
	catch(_err)
	{
		console.warn('Unable to open `%s`!',
			docs.splice(i--, 1)[0].error());
		console.error(_err.message);
		++err;
	}
}

console.eol();

if(docs.length === 0)
{
	console.error('Unable to load any document!');
	process.exit(2);
}

console.info('Successfully loaded %s document' +
	(docs.length === 1 ? '' : 's') + '.',
	docs.length.toLocaleString().warn());

if(err > 0)
{
	console.warn('But %s document' + (err === 1 ? '' : 's') +
		' couldn\'t be read!', err.toLocaleString().error());
}

console.eol();

//TODO/
const result = docs[0].getText();
console.dir(result);

