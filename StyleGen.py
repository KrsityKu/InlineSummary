# Written by ChatGPT, I've not looked at what it actually does... but it works.
import sys
import cssutils
from pathlib import Path
import re

# List of exact class names to duplicate
CLASS_NAMES = ["mes_text", "mes_img"]

def transform_selector(selector_text, class_names):
	"""
	Takes a selector string (possibly comma-separated),
	finds selectors containing any class in class_names,
	and makes a copy with 'ils_' prefix.
	"""
	selectors = [s.strip() for s in selector_text.split(",")]
	new_selectors = []

	for sel in selectors:
		for cls in class_names:
			# Match exact class name using word boundary \b
			pattern = rf"(?<![-\w])\.{cls}(?![-\w])"
			if re.search(pattern, sel):
				new_sel = re.sub(pattern, f".ils_{cls}", sel)
				new_selectors.append(new_sel)
				break  # Avoid duplicating the same selector for multiple classes

	return ", ".join(new_selectors)


def extract_rules_with_classes(input_path, output_path, class_names):
	cssutils.log.setLevel("FATAL")  # suppress warnings

	sheet = cssutils.parseFile(input_path)
	new_sheet = cssutils.css.CSSStyleSheet()

	for rule in sheet:
		if rule.type == rule.STYLE_RULE:
			if any(re.search(rf"(?<![-\w])\.{cls}(?![-\w])", rule.selectorText) for cls in class_names):
				new_selector = transform_selector(rule.selectorText, class_names)
				if new_selector:
					new_rule = cssutils.css.CSSStyleRule(
						selectorText=new_selector,
						style=rule.style.cssText
					)
					new_sheet.add(new_rule)

		# Handle @media rules (can extend to other at-rules if needed)
		elif rule.type in (rule.MEDIA_RULE,):
			media_rule = cssutils.css.CSSMediaRule(mediaText=rule.media.mediaText)
			for subrule in rule.cssRules:
				if subrule.type == subrule.STYLE_RULE and any(
					re.search(rf"(?<![-\w])\.{cls}(?![-\w])", subrule.selectorText) for cls in class_names
				):
					new_selector = transform_selector(subrule.selectorText, class_names)
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
	output_css = "ils_styles.css"

	extract_rules_with_classes(input_css, output_css, CLASS_NAMES)
	print(f"Generated {output_css} from {input_css}")
