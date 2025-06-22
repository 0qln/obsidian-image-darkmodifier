# Image Darkmodifier

Obsidian Plugin.

Apply filters, such as darkmode effects (with transparency), to your markdown image links.

This is what it might look like:

(todo: add image)


## How to use this? 

1. Add the plugin

2. Just add the filters to the alias part of your image link:

```md

Normal embed:
`![[image.png|image-description]]`

Embed with darkmode: 
`![[image.png|image-description @darkmode]]`

Where darkmode is essentially just a shorthand for this:
`![[image.png|image-description @invert @transparent(threshold="rgb((13, 13, 13))", remove="below") @boost-lightness(amount=1.2)]]`

```

The filter are applied in order left to right.


## Filter Syntax

will look like this for most cases:

```
@filter-name(boolean-param, int-param=42, float-param=-6.9, string-param="text-value")
```

For string values, the following characters have to be written in a special way:
- `"` => `""`
- `(` => `((`
- `)` => `))`

Backslashes are not allowed. (Due to how the image-alt is parsed by obsidian.)


## Link support

All kind's of link notation are supported:

```md
![[image.png | image-description @darkmode]]
```
```md
![image-description @darkmode | 410](image.png)
```
```md
<img src="image.png" alt="image-description @darkmode" style="height: 410px">
```


You can even use image links to remote images:

```md
![image @invert](https://i.pinimg.com/736x/fb/74/eb/fb74ebfb80a42e0ae5a26b86d9f2fe47.jpg)
```


## The following filters can be used:

### Darkmode

Reccomended for use on images with white backgrounds (e.g. screenshots of diagrams in papers). Invertes the image, removes the background, and boosts the lightness by 1.2

Essentially just a shorthand for: `@invert @transparent(threshold="rgb((13, 13, 13))", remove="below") @boost-lightness(amount=1.2)`.

name: `@darkmode`
params: none.


### Invert

Inverts the image.

name: `@invert`
params: none.


### Lightness boost

Converts the image pixel representation to hsl, and boosts the lightness.

name: `@boost-lightness`
params: 
- `amount`:
	- float-value: the amount by which to boost the lightness.


#### Transparency

Make pixels below or above a certain threshold transparent.

name: `@transparent`
params: 
- `remove`:
	- string-value: can be either `"above"` or `"below"`
 		- if `"above"`: removes pixels above the threshold
   		- if `"below"`: removes pixels below the threshold
- `threshold`: all pixels that have `r`, `g` and `b` channels above or below this threshold will be made transparent.
	- int-value: compare all channels to the same threshold
 	- string-value: can be any css-parsable string. e.g. `"rgb((69, 42, 3))"` or `"hsl((35deg, 91.7%, 14.1%))"` would have the same effect:
      ![image](https://github.com/user-attachments/assets/841494f7-66ec-426a-b8ab-32e4db2d8190)


## Contributing

Feel free to open pullrequests or issues. Adding new filters is really straight forward, you can use existing filters for reference.
