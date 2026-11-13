# Original photos

Full-size camera originals (up to 23 MB each). They're kept here, outside
`public/`, so they aren't deployed with the website.

The site uses web-sized copies in `public/images/web/` (about 150–500 KB).
To add or replace one:

```bash
sips -Z 1600 -s format jpeg -s formatOptions 72 originals/NAME.jpg --out public/images/web/NAME.jpg
```
