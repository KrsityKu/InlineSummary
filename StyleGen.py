# Written by ChatGPT, I've not looked at what it actually does... but it works.
import sys
import cssutils
from pathlib import Path

def transform_selector(selector_text):
	"""
	Takes a selector string (possibly comma-separated),
	keeps only parts containing .mes_text,
	replaces .mes_text with .ils_mes_text.
	"""
	selectors = [s.strip() for s in selector_text.split(",")]
	new_selectors = []

	for sel in selectors:
		if ".mes_text" in sel:
			new_sel = sel.replace(".mes_text", ".ils_mes_text")
			new_selectors.append(new_sel)

	return ", ".join(new_selectors)


def extract_mes_text_rules(input_path, output_path):
	cssutils.log.setLevel("FATAL")  # suppress warnings

	sheet = cssutils.parseFile(input_path)
	new_sheet = cssutils.css.CSSStyleSheet()

	for rule in sheet:
		if rule.type == rule.STYLE_RULE:
			if ".mes_text" in rule.selectorText:
				new_selector = transform_selector(rule.selectorText)

				if new_selector:
					new_rule = cssutils.css.CSSStyleRule(
						selectorText=new_selector,
						style=rule.style.cssText
					)
					new_sheet.add(new_rule)

		# Optional: copy @keyframes, @media etc. if they contain mes_text
		elif rule.type in (rule.MEDIA_RULE,):
			media_rule = cssutils.css.CSSMediaRule(mediaText=rule.media.mediaText)

			for subrule in rule.cssRules:
				if subrule.type == subrule.STYLE_RULE and ".mes_text" in subrule.selectorText:
					new_selector = transform_selector(subrule.selectorText)
					if new_selector:
						new_rule = cssutils.css.CSSStyleRule(
							selectorText=new_selector,
							style=subrule.style.cssText
						)
						media_rule.add(new_rule)

			if media_rule.cssRules:
				new_sheet.add(media_rule)

	Path(output_path).write_text(new_sheet.cssText.decode("utf-8"), encoding="utf-8")


if __name__ == "__main__":
	input_css = "../../../../style.css"
	output_css = "ils_mes_text.css"

	extract_mes_text_rules(input_css, output_css)
	print(f"Generated {output_css} from {input_css}")
