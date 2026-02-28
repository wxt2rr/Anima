on replaceText(findText, replaceText, sourceText)
	set AppleScript's text item delimiters to findText
	set itemsList to every text item of sourceText
	set AppleScript's text item delimiters to replaceText
	set outText to itemsList as text
	set AppleScript's text item delimiters to ""
	return outText
end replaceText

on jsonEscape(s)
	set t to (s as text)
	set t to my replaceText("\\", "\\\\", t)
	set t to my replaceText("\"", "\\\"", t)
	set t to my replaceText(return, "\\n", t)
	set t to my replaceText(linefeed, "\\n", t)
	return t
end jsonEscape

on joinList(theList, delim)
	set AppleScript's text item delimiters to delim
	set outText to theList as text
	set AppleScript's text item delimiters to ""
	return outText
end joinList

on usageJson()
	return "{\"ok\":false,\"error\":\"usage: osascript list_reminders.applescript [listName] [status] [limit]\"}"
end usageJson

on run argv
	if (count of argv) is 0 then return my usageJson()
	set listNameText to ""
	if (count of argv) ≥ 1 then set listNameText to (item 1 of argv) as text

	set statusText to "incomplete"
	if (count of argv) ≥ 2 then set statusText to (item 2 of argv) as text

	set limitText to "50"
	if (count of argv) ≥ 3 then set limitText to (item 3 of argv) as text

	set limitN to 50
	try
		set limitN to limitText as integer
	end try
	if limitN < 1 then set limitN to 1

	try
		tell application "Reminders"
			if listNameText is "" then
				set targetList to default list
			else
				set targetList to list listNameText
			end if

			if statusText is "completed" then
				set rs to reminders of targetList whose completed is true
			else if statusText is "all" then
				set rs to reminders of targetList
			else
				set rs to reminders of targetList whose completed is false
			end if
		end tell

		set outItems to {}
		set i to 0
		repeat with r in rs
			set i to i + 1
			if i > limitN then exit repeat

			tell application "Reminders"
				set rid to id of r as text
				set rname to name of r as text
				set rbody to body of r as text
				set rcompleted to completed of r as boolean

				set rdue to ""
				try
					set d to due date of r
					if d is not missing value then set rdue to d as text
				end try

				set rcompletedAt to ""
				try
					set cd to completion date of r
					if cd is not missing value then set rcompletedAt to cd as text
				end try
			end tell

			set itemJson to "{\"id\":\"" & my jsonEscape(rid) & "\",\"title\":\"" & my jsonEscape(rname) & "\",\"notes\":\"" & my jsonEscape(rbody) & "\",\"due\":\"" & my jsonEscape(rdue) & "\",\"completed\":" & (rcompleted as text) & ",\"completedAt\":\"" & my jsonEscape(rcompletedAt) & "\"}"
			set end of outItems to itemJson
		end repeat

		return "{\"ok\":true,\"items\":[" & my joinList(outItems, ",") & "]}"
	on error errMsg number errNum
		return "{\"ok\":false,\"error\":\"" & my jsonEscape(errMsg) & "\",\"code\":" & errNum & "}"
	end try
end run
