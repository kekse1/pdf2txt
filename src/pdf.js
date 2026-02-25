/*
 * Copyright (c) Sebastian Kucharczyk <kuchen@kekse.biz>
 * https://kekse.biz/
 */

//
const DEFAULT_THROW = true;
const DEFAULT_THROW_ARGS = true;

//
import fs from 'node:fs';
import zlib from 'node:zlib';
import EventEmitter from 'node:events';

//
const PDF = class PDF extends EventEmitter
{
	constructor(... _args)
	{
		super();
		this.reset();

		var	temp,
			input = null,
			buffer = null,
			throwArgs = DEFAULT_THROW_ARGS;

		for(var i = 0; i < _args.length; ++i)
		{
			if(bool(_args[i]))
			{
				this.throw = _args.splice(i--, 1)[0];
			}
			else if(temp = this.constructor.toBuffer(_args[i]))
			{
				_args.splice(i--, 1);
				buffer = temp;
			}
			else if(object(_args[i]))
			{
				temp = _args.splice(i--, 1)[0];

				for(const idx in temp) switch(idx)
				{
					case 'path':
						if(pathname(temp[idx]))
						{
							input = temp[idx];
						}
						break;
					case 'throw':
						if(bool(temp.throw))
						{
							this.throw = temp[idx];
						}
						break;
					case 'data':
						buffer = this.constructor.toBuffer(
							temp[idx]);
						break;
					case 'argumentThrow':
						if(bool(temp[idx]))
						{
							throwArgs = temp[idx];
						}
						break;
				}
			}
		}

		if(_args.length > 0 && throwArgs)
		{
			throw new Error('At least one invalid constructor argument');
		}

		if(input !== null && buffer === null) try
		{
			buffer = fs.readFileSync(input);
			input = null;
		}
		catch(_err)
		{
			throw _err;
		}

		if(buffer)
		{
			if(input !== null)
			{
				throw new Error('Please define only one of a path or concrete data.');
			}

			this.buffer = buffer;
		}
	}
	
	static isData(_value)
	{
		if(was(_value, 'Buffer'))
		{
			return true;
		}
		
		if(was(_value, 'TypedArray'))
		{
			return true;
		}
		if(string(_value, true))
		{
			return true;
		}
		
		return false;
	}
	
	static toBuffer(_value)
	{
		if(was(_value, 'Buffer'))
		{
			return _value;
		}
		
		if(was(_value, 'TypedArray'))
		{
			return Buffer.from(_value);
		}
		
		if(string(_value, true))
		{
			return Buffer.from(_value, 'latin1');
		}
		
		return null;
	}

	static create(... _args)
	{
		return new this(... _args);
	}

	reset()
	{
		const result = (this.objects || null);

		this.objects = new Map();
		this._buffer = null;

		this.throw = DEFAULT_THROW;

		this.emit('reset', {
			objects: result });
		return result;
	}

	get isOpen()
	{
		return !!this._buffer;
	}

	get buffer()
	{
		return (this._buffer || null);
	}

	set buffer(_value)
	{
		if(this._buffer = _value)
		{
			this.createIndex();
			return true;
		}

		this._buffer = null;
		return false;
	}

	//
	// low level api (following)
	//
	createIndex()
	{
		var	result,
			header;

		for(var i = 0; i < this._buffer.length; ++i)
		{
			if(!this.constructor.isDigit(this._buffer[i]))
			{
				continue;
			}
			
			if(header = this.readObjectHeader(i))
			{
				result = this.parseObject(header.next);
				this.objects.set(`${header.id}:${header.gen}`,
					result.value);
				i = result.next;
			}
		}
	}

	static isDigit(_data)
	{
		if(typeof _data === 'undefined')
		{
			return null;
		}

		if(typeof _data === 'string')
		{
			_data = _data.charCodeAt(0);
		}
		
		return (_data >= 0x30 && _data <= 0x39);
	}

	static isWhiteSpace(_data)
	{
		if(typeof _data === 'undefined')
		{
			return null;
		}

		if(typeof _data === 'string')
		{
			_data = _data.charCodeAt(0);
		}
		
		return [ 0, 9, 10, 13, 32 ].includes(_data);
	}

	readInt(_index)
	{
		var	result = '',
			i = _index;

		while(this.constructor.isDigit(this._buffer[i]))
		{
			result += String.fromCharCode(this._buffer[i]);
			++i;
		}
		
		if(result.length === 0)
		{
			return null;
		}

		return { value: Number(result), next: i };
	}

	readObjectHeader(_index)
	{
		var i = _index;
		var id = this.readInt(i);
		
		if(id === null)
		{
			return null;
		}

		i = id.next;

		while(this.constructor.isWhiteSpace(this._buffer[i]))
		{
			++i;
		}

		var gen = this.readInt(i);
		
		if(gen === null)
		{
			return null;
		}

		i = gen.next;

		while(this.constructor.isWhiteSpace(this._buffer[i]))
		{
			++i;
		}

		if(this._buffer[i] === 0x6f &&
			this._buffer[i + 1] === 0x62 &&
			this._buffer[i + 2] === 0x6a)
		{
			return { id: id.value,
				 gen: gen.value,
				 next: (i + 3) };
		}

		return null;
	}

	parseObject(_index)
	{
		var i = _index;

		while(this.constructor.isWhiteSpace(this._buffer[i]))
		{
			++i;
		}

		if(this._buffer[i] === 0x3c && this._buffer[i + 1] === 0x3c)
		{
			return this.parseDictionary(i);
		}

		if(this._buffer[i] === 0x5b)
		{
			return this.parseArray(i);
		}
		
		if(this._buffer[i] === 0x28)
		{
			return this.parseString(i);
		}

		if(this._buffer[i] === 0x2f)
		{
			return this.parseName(i);
		}

		if(this.constructor.isDigit(this._buffer[i]) ||
			this._buffer[i] === 0x2d)
		{
			return this.parseNumberOrRef(i);
		}

		return { value: null, next: (i + 1) };
	}

	parseDictionary(_index)
	{
		const result = {};
		var i = (_index + 2);
		var key, value, end;

		while(i < this._buffer.length)
		{
			while(this.constructor.isWhiteSpace(this._buffer[i]))
			{
				++i;
			}

			if(this._buffer[i] === 0x3e && this._buffer[i + 1] === 0x3e)
			{
				i += 2;
				break;
			}

			key = this.parseName(i);
			value = this.parseObject(key.next);

			result[key.value] = value.value;
			i = value.next;
		}

		while(this.constructor.isWhiteSpace(this._buffer[i]))
		{
			++i;
		}

		if(this.match(i, 'stream'))
		{
			i += 6;
			
			if(this._buffer[i] === 0x0d)
			{
				++i;
			}

			if(this._buffer[i] === 0x0a)
			{
				++i;
			}
			
			if((end = this.find(i, 'endstream')) > -1)
			{
				result._stream = this._buffer.subarray(i, end);
				i = (end + 9);
			}
		}

		return { value: result, next: i };
	}

	parseArray(_index)
	{
		const	result = [];
		var	i = (_index + 1), object;

		while(i < this._buffer.length && this._buffer[i] !== 0x5d)
		{
			while(this.constructor.isWhiteSpace(this._buffer[i]))
			{
				++i;
			}

			if(this._buffer[i] === 0x5d)
			{
				break;
			}

			object = this.parseObject(i);

			if(object === null)
			{
				break;
			}

			result.push(object.value);
			i = object.next;
		}

		return { value: result, next: ++i };
	}

	parseString(_index)
	{
		const	result = [];
		var	i = (_index + 1), depth = 1;

		do
		{
			if(this._buffer[i] === 0x28)
			{
				++depth;
			}
			else if(this._buffer[i] === 0x29)
			{
				--depth;
			}

			++i;

			if(depth > 0)
			{
				result.push(this._buffer[i - 1]);
			}
			else
			{
				break;
			}
		}
		while(i < this._buffer.length);

		return { value: Buffer.from(result).
				toString('latin1'), next: i };
	}
	
	static get nameDelimiters()
	{
		return [
			0x3c, 0x3e,
			0x5b, 0x5d,
			0x28, 0x29,
			0x2f, 0x7b,
			0x7d, 0x25
		];
	}

	parseName(_index)
	{
		const	delim = this.constructor.nameDelimiters;
		var	result = '', b,
			i = (_index + 1);

		while(i < this._buffer.length)
		{
			b = this._buffer[i];
			
			if(this.constructor.isWhiteSpace(b) || delim.includes(b))
			{
				break;
			}
			
			result += String.fromCharCode(b);
			++i;
		}
		
		return { value: result, next: i };
	}

	parseNumberOrRef(_index)
	{
		var	result = '',
			i = _index;

		while(i < this._buffer.length && this.constructor.isDigit(this._buffer[i]) ||
			this._buffer[i] === 0x2d || this._buffer[i] === 0x2e)
		{
			result += String.fromCharCode(this._buffer[i++]);
		}

		while(this.constructor.isWhiteSpace(this._buffer[i]))
		{
			++i;
		}

		const savedIndex = i;

		if(this.constructor.isDigit(this._buffer[i]))
		{
			do
			{
				++i;
			}
			while(this.constructor.isDigit(this._buffer[i]));

			while(this.constructor.isWhiteSpace(this._buffer[i]))
			{
				++i;
			}

			if(this._buffer[i] === 0x52)
			{
				return { value: { ref: Number(result) },
					 next: (i + 1) };
			}
		}

		return { value: Number(result),
			 next: savedIndex };
	}

	match(_index, _string)
	{
		for(var i = 0; i < _string.length; ++i)
		{
			if(this._buffer[_index + i] !== _string.charCodeAt(i))
			{
				return false;
			}
		}

		return true;
	}

	find(_index, _data)
	{
		if(null === (_data = this.constructor.toBuffer(_data)))
		{
			return null;
		}

		for(var i = _index; i < this._buffer.length; ++i)
		{
			if(this._buffer.subarray(i, i + _data.length).equals(_data))
			{
				return i;
			}
		}

		return -1;
	}
	
	//
	static unescape(_data)
	{
		if(null === (_data = this.toBuffer(_data)))
		{
			return null;
		}
		
		var	result = '',
			next, octal;
		
		for(var i = 0; i < _data.length; ++i)
		{
			if(_data[i] === 0x5c)
			{
				next = _buffer[i++];
				
				if(next === 0x6e)
				{
					result += '\n';
				}
				else if(next === 0x72)
				{
					result += '\r';
				}
				else if(next === 0x74)
				{
					result += '\t';
				}
				else if(next === 0x28 || next === 0x29 || next === 0x5c)
				{
					result += String.fromCharCode(next);
				}
				else if(this.isDigit(next))
				{
					octal = String.fromCharCode(next) +
						String.fromCharCode(_data[++i]);
					result += String.fromCharCode(
						parseInt(octal, 8));
				}
				//...?
			}
			else
			{
				result += String.fromCharCode(
					_data[i]);
			}
		}
		
		return result;
	}

	//
	// high level api (following)
	//
	resolve(_object)
	{
		if(_object && _object.ref)
		{
			return this.objects.get(`${_object.ref}:0`);
		}
		
		return _object;
	}
	
	getFontMap(_ref)
	{
		const font = this.resolve(_ref);
		
		if(!font || !font.ToUnicode)
		{
			return null;
		}
		
		const stream = this.resolve(font.ToUnicode);
		
		if(!stream || !stream._stream)
		{
			return null;
		}
		
		var data = stream._stream;
		
		try
		{
			switch(stream.Filter)
			{
				case 'FlateDecode':
					data = zlib.unzipSync(data);
					break;
			}
		}
		catch(_err)
		{
			if(this.throw)
			{
				throw _err;
			}
		}
		
		const result = new Map();
		const content = data.toString('latin1');
		
		// Simpler CMap Parser (bfchar & bfrange)
		const charMatches = content.matchAll(
			/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g);
		
		for(const m of charMatches)
		{
			result.set(parseInt(m[1], 16),
				String.fromCharCode(
					parseInt(m[2], 16)));
		}
		
		return result;
	}
	
	getText(... _pages)
	{
		if(_pages.length > 0)
		{
			return this.getTextPage(... _pages);
		}
		
		const catalog = Array.from(this.objects.values()).
			find((_obj) => (_obj && _obj.Type === 'Catalog'));

		if(!catalog)
		{
			return '';
		}
		
		const	pagesRoot = this.resolve(catalog.Pages);
		var	result = '', streamObject, data;

		this.walkPages(pagesRoot, (_page) => {
			const interpreter = new PDFInterpreter(this, _page);
			const contents = (Array.isArray(_page.Contents) ?
				_page.Contents : [ _page.Contents ]);

			contents.forEach((_ref) => {
				if((streamObject = this.resolve(_ref)) &&
					streamObject._stream)
				{
					data = streamObject._stream;
					
					try
					{
						switch(streamObject.Filter)
						{
							case 'FlateDecode':
								data = zlib.unzipSync(data);
								break;
						}
					}
					catch(_err)
					{
						if(this.throw)
						{
							throw _err;
						}
					}
					
					interpreter.interprete(this.
						constructor.tokenize(data));
				}
			});
			
			result += interpreter.formatter.
				format() + '\n';
		});
		
		return result;
	}
	
	getTextPage(... _pages)
	{
		for(var i = _pages.length - 1; i >= 0; --i)
		{
			if(!int(_pages[i]))
			{
				_pages.splice(i, 1);
			}
		}
		
		if(_pages.length === 0)
		{
			if(this.throw)
			{
				throw new Error('No page(s) defined/left');
			}
			
			return null;
		}
		
		_pages = new Set(_pages);

		const	catalog = Array.from(this.objects.values()).
			find(i => (i && i.Type === 'Catalog'));
		var	currentPage = 0, result = '', data,
			interpreter, contents, stream;
		
		this.walkPages(catalog.Pages, (_page) => {
			if(_pages.has(++currentPage))
			{
				interpreter = new PDFInterpreter(
					this, _page);
				contents = (Array.isArray(_page.Contents) ?
					_page.Contents : [ _page.Contents ]);
				
				contents.forEach((_ref) => {
					if((stream = this.resolve(_ref)) && stream._stream)
					{
						data = stream._stream;

						try
						{
							switch(stream.Filter)
							{
								case 'FlateDecode':
									data = zlib.unzipSync(data);
									break;
							}
						}
						catch(_err)
						{
							if(this.throw)
							{
								throw _err;
							}
						}
						
						interpreter.interprete(this.constructor.
							tokenize(data));
					}
				});
				
				result += interpreter.formatter.format() + '\n';
			}
		});

		return result.slice(0, -1);
	}

	walkPages(_ref, _callback)
	{
		const node = this.resolve(_ref);
		
		if(node === null)
		{
			//_callback(null);
			return null;
		}
		
		if(node.Type === 'Page')
		{
			_callback(node);
		}
		else if(node.Kids)
		{
			node.Kids.forEach((_kid) => this.
				walkPages(_kid, _callback));
		}
	}

	static tokenize(_buffer)
	{
		const	result = []; //token[];
		var	i = 0, b, start, depth, sub;
		
		while(i < _buffer.length)
		{
			b = _buffer[i];
			
			if(this.isWhiteSpace(b))
			{
				++i;
				continue;
			}
			
			if(b === 0x28)
			{
				depth = 1;
				start = i++;
				
				while(depth > 0 && i < _buffer.length)
				{
					if(_buffer[i] === 0x28)
					{
						++depth;
					}
					else if(_buffer[i] === 0x29)
					{
						--depth;
					}
					
					++i;
				}
				
				result.push({
					type: 'string',
					value: _buffer.subarray(start + 1, i - 1).
						toString('latin1') });
			}
			else if(b === 0x3c)
			{
				start = ++i;
				
				while(i < _buffer.length && _buffer[i] !== 0x3e)
				{
					++i;
				}
				
				result.push({
					type: 'hex',
					value: _buffer.subarray(start, i++).
						toString() });
			}
			else if(b === 0x5b)
			{
				result.push({
					type: 'operator',
					value: '[' });
				++i;
			}
			else if(b === 0x5d)
			{
				result.push({
					type: 'operator',
					value: ']' });
				++i;
			}
			else if(b === 0x2f)
			{
				sub = '';
				++i;
				
				while(i < _buffer.length && ![0, 9, 10, 13, 32, 40, 47, 60, 91].
					includes(_buffer[i]))
				{
					sub += String.fromCharCode(_buffer[i++]);
				}
				
				result.push({
					type: 'name',
					value: sub });
			}
			else if((b >= 0x30 && b <= 0x39) || b === 0x2d || b === 0x2e)
			{
				sub = '';
				
				while(i < _buffer.length && ((_buffer[i] >= 0x30 && _buffer[i] <= 0x39) ||
					_buffer[i] === 0x2d || _buffer[i] === 0x2e))
				{
					sub += String.fromCharCode(_buffer[i++]);
				}
				
				result.push({
					type: 'number',
					value: Number(sub) });
			}
			else
			{
				sub = '';
				
				while(i < _buffer.length && _buffer[i] >= 0x21 && _buffer[i] <= 0x7e &&
					!((_buffer[i] >= 0x30 && _buffer[i] <= 0x39)))
				{
					sub += String.fromCharCode(_buffer[i++]);
				}
				
				if(sub)
				{
					result.push({
						type: 'operator',
						value: sub });
				}
				else
				{
					++i;
				}
			}
		}
		
		return result;
	}
	
	//
	getObject(_id)
	{
		throw new Error('todo');
	}

	getPage(_n)
	{
		throw new Error('todo');
	}

	resolve(_ref)
	{
		if(_ref && _ref.ref)
		{
			return (this.objects.get(`${_ref.ref}:0`) || null);
		}

		return (_ref || null);
	}

	//
	//todo/static? bzw nutze eigene members!1
	//todo/.....
	//
	extractText(_page = 1)
	{
		const page = this.getPage(_page = (_page || 1));
		const interpreter = new PDFInterpreter(this);
		const streams = (Array.isArray(page.contents) ?
			page.contents : [ page.contents ]);
		const elements = [];

		for(const ref of streams)
		{
			elements = elements.concat(
				interpreter.parse(
					this.resolve(ref)));
		}

		const formatter = new PDFFormatter(this);
		return formatter.render();
	}
}

//
const PDFInterpreter = PDF.Interpreter = class PDFInterpreter
{
	constructor(_pdf, _page)
	{
		if(! (_pdf && _page))
		{
			throw new Error('Please argue with your PDF instance and a Page');
		}

		this.parent = _pdf;
		this.page = _page;

		this.formatter = new PDFFormatter(this);

		this.reset();
	}

	reset()
	{
		// default "current transformation matrix" (ctm) @ default "identitaet"
		this.ctm = [ 1, 0, 0, 1, 0, 0 ];
		this.txt = [ 1, 0, 0, 1, 0, 0 ];

		this.stack = [];
		this.elements = [];

		this.currentFontMap = null;
	}
	
	multiply(_a, _b)
	{
		const [ a1, b1, c1, d1, e1, f1 ] = _a;
		const [ a2, b2, c2, d2, e2, f2 ] = _b;
		
		return [
			a1 * a2 + b1 * c2,
			a1 * b2 + b1 * d2,
			c1 * a2 + d1 * c2,
			c1 * b2 + d1 * d2,
			e1 * a2 + f1 * c2 + e2,
			e1 * b2 + f1 * d2 + f2 ];
		/*return [ _a[0] * _b[0] + _a[1] * _b[2],
			 _a[0] * _b[1] + _a[1] * _b[3],
			 _a[2] * _b[0] + _a[3] * _b[2],
			 _a[2] * _b[1] + _a[3] * _b[3],
			 _a[4] * _b[0] + _a[5] * _b[2] + _b[4],
			 _a[4] * _b[1] + _a[5] * _b[3] + _b[5] ];*/
	}

	operator(_item)
	{
		var tx, ty, sub, a, b, c, d, e, f;
		
		switch(_item)
		{
			case 'BT':
				this.txt = [ 1, 0, 0, 1, 0, 0 ];
				break;
			case 'cm':
				this.ctm = this.multiply(
					this.stack.splice(-6), this.ctm);
				break;
			case 'Tm':
				this.txt = this.stack.splice(-6);
				break;
			case 'Td':
				[ tx, ty ] = this.stack.splice(-2);
				this.txt = this.multiply(
					[ 1, 0, 0, 1, tx, ty ], this.txt);
				break;
			case 'Tj':
				this.push(this.stack.pop());
				break;
			case 'TJ':
				if(Array.isArray(sub = this.stack.pop()))
				{
					sub = sub.
						filter(_v = typeof v === 'string').
						join('');
					this.push(sub);
				}
				break;
			case 'T*':
				this.txt = this.multiply(
					[ 1, 0, 0, 1, 0, -12 ], this.txt)
				break;
		}
		
		this.stack.length = 0;
	}
	
	push(_data)
	{
		const m = this.multiply(this.txt, this.ctm);
		return this.elements.push({ type: 'text',
			data: _data, x: m[4], y: m[5],
			fontSize: m[3], matrix: m });
	}
	
	//
	//TODO/wird das passend aufgerufen, statt original '.emitElement("text", ..)' immer?!?
	//
	decodeAndEmit(_value)
	{
		this.emitElement('text',
			this.decodeString(_value));
	}
	
	decodeString(_value)
	{
		if(!this.currentFontMap)
		{
			return _value;
		}
		
		var	result = '',
			code;
		
		for(var i = 0; i < _value.length; ++i)
		{
			code = _value.charCodeAt(i);
			result += (this.currentFontMap.
				get(code) || _value[i]);
		}
		
		return result;
	}

	interprete(_tokens)
	{
		_tokens.forEach((_t) => {
			if(_t.Type === 'operator')
			{
				this.operator(_t.value);
			}
			else
			{
				this.stack.push(_t.value);
			}
		});

		return this.elements;
	}
}

//
// fuer die raeumliche anordnung
//
const PDFFormatter = PDF.Formatter = class PDFFormatter
{
	constructor(_interpreter)
	{
		if(!_interpreter)
		{
			throw new Error('Please argue with your PDFInterpreter instance');
		}
		
		this.parent = _interpreter;
	}

	get pdf()
	{
		return this.parent.parent;
	}

	get interpreter()
	{
		return this.parent;
	}

	get elements()
	{
		return this.parent.elements;
	}

	static get constants()
	{
		return [ 2, 5, 3, 5 ];
	}
	
	format()
	{
		const elements = this.elements.filter(
			(_item) => (_item.Type === 'text' && _item.data));
		
		if(elements.length === 0)
		{
			return '';
		}
		
		const constants = this.constructor.constants;
		elements.sort((_a, _b) => ((Math.abs(_a.y - _b.y) >
			constants[0]) ? (_b.y - _a.y) : (_a.x - _b.x)));
		
		var	lastX = elements[0].x,
			lastY = elements[0].y,
			result = '';
			
		for(const item of elements)
		{
			if(Math.abs(item.y - lastY) > constants[1])
			{
				result += '\n';
			}
			else if((item.x - lastX) > constants[2])
			{
				result += ' ';
			}
			
			result += item.data;

			lastX = (item.x + (item.data.length * constants[3]));
			lastY = item.y;
		}
		
		return result;
		
	}

	render()
	{
		throw new Error('todo');

		// Sortiert die Elemente nach Y und X und baut den String
		return "(extrahierter text)";
	}
}

//
export default PDF;
export { PDF, PDFInterpreter, PDFFormatter };

//

/*
 * usage as follows?!?
 *
 * 	const doc = PDF.create('./example.pdf');
 *
 * 	if(doc)
 * 	{
 * 		const text = doc.getText();
 *
 * 		console.log('--- Text extraction ---');
 * 		console.log(text);
 * 		console.log('-----------------------');
 * 	}
 *	else
 *	{
 *		console.error('Unable to read your PDF input file!');
 *	}
 *
 */

//

