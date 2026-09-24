-- Brand project colors (task 033): each stored light hex moves to the new color in the same
-- slot of src/lib/colors.ts. Data only. The previous app version shows a color outside its
-- palette as stored, so it keeps working until the deploy is promoted.
UPDATE project SET color = CASE lower(color)
  WHEN '#2a78d6' THEN '#3b82b8'
  WHEN '#eb6834' THEN '#d9703f'
  WHEN '#1baf7a' THEN '#1f9e8a'
  WHEN '#eda100' THEN '#d59a1c'
  WHEN '#e87ba4' THEN '#c9759f'
  WHEN '#008300' THEN '#4f8f3a'
  WHEN '#4a3aa7' THEN '#5a4fa8'
  WHEN '#e34948' THEN '#c9514f'
END
WHERE lower(color) IN ('#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948');
