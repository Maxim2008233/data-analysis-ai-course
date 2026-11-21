# -*- coding: utf-8 -*-
"""Отзывы для уроков модуля 9: (текст, метка, тема, язык). Метка — замысел автора: 1 — положительный, 0 — отрицательный.

Отзывы написаны для курса. Темы: кино, еда, товары, отели, сервисы; «tricky» — отрицания, сарказм и смешанные
оценки, на которых модели ошибаются чаще; «notebook» — фразы из Workshops/09_HF_intro.ipynb и курса Hugging Face;
русские отзывы показывают, что английская модель русского языка не знает.
"""

REVIEWS = [
    # кино — положительные
    ("An absolute masterpiece with stunning visuals and a moving story.", 1, "movie", "en"),
    ("I laughed from start to finish, what a delightful comedy.", 1, "movie", "en"),
    ("The acting was superb and the soundtrack gave me chills.", 1, "movie", "en"),
    ("One of the best films I have seen this year.", 1, "movie", "en"),
    ("A warm, clever and beautifully shot movie.", 1, "movie", "en"),
    ("The plot kept me on the edge of my seat until the very end.", 1, "movie", "en"),
    ("Brilliant performances from the whole cast.", 1, "movie", "en"),
    ("I would happily watch it again tomorrow.", 1, "movie", "en"),
    # еда — положительные
    ("The pasta was perfectly cooked and the staff were lovely.", 1, "food", "en"),
    ("Fresh ingredients, generous portions and fair prices.", 1, "food", "en"),
    ("Best pizza in town, hands down.", 1, "food", "en"),
    ("Cozy atmosphere and the desserts are to die for.", 1, "food", "en"),
    ("Our waiter was friendly and the food arrived quickly.", 1, "food", "en"),
    ("Every dish we ordered was full of flavour.", 1, "food", "en"),
    # товары — положительные
    ("This phone has an amazing battery life.", 1, "product", "en"),
    ("The headphones sound fantastic and feel very comfortable.", 1, "product", "en"),
    ("Great value for the money, it works exactly as described.", 1, "product", "en"),
    ("Setup took two minutes and everything just worked.", 1, "product", "en"),
    ("Sturdy, light and beautifully designed.", 1, "product", "en"),
    ("My kids love this toy and play with it every day.", 1, "product", "en"),
    # отели — положительные
    ("The room was spotless and the view was breathtaking.", 1, "hotel", "en"),
    ("Helpful staff and a fantastic breakfast.", 1, "hotel", "en"),
    ("We had a wonderful stay and will definitely come back.", 1, "hotel", "en"),
    ("Quiet, comfortable beds and a great location.", 1, "hotel", "en"),
    # сервисы — положительные
    ("The app is fast, simple and does exactly what I need.", 1, "service", "en"),
    ("Customer support solved my problem in five minutes.", 1, "service", "en"),
    ("Delivery was early and the package was well protected.", 1, "service", "en"),
    ("This course explained everything clearly, thank you!", 1, "service", "en"),
    ("I really enjoyed the concert, the band was incredible.", 1, "service", "en"),
    ("The book is gripping and wonderfully written.", 1, "service", "en"),
    # кино — отрицательные
    ("A boring, predictable film that felt twice as long as it was.", 0, "movie", "en"),
    ("The dialogue was awful and the plot made no sense.", 0, "movie", "en"),
    ("I walked out halfway through, what a waste of time.", 0, "movie", "en"),
    ("Terrible acting and cheap special effects.", 0, "movie", "en"),
    ("The worst sequel I have ever seen.", 0, "movie", "en"),
    ("I could not care less about any of the characters.", 0, "movie", "en"),
    ("Painfully slow and completely forgettable.", 0, "movie", "en"),
    ("The ending ruined the whole movie for me.", 0, "movie", "en"),
    # еда — отрицательные
    ("The soup was cold and the bread was stale.", 0, "food", "en"),
    ("We waited an hour for our food and nobody apologized.", 0, "food", "en"),
    ("Overpriced, bland and tiny portions.", 0, "food", "en"),
    ("The waiter was rude and the table was dirty.", 0, "food", "en"),
    ("I got food poisoning after eating there.", 0, "food", "en"),
    ("The steak was burnt and tasted like rubber.", 0, "food", "en"),
    # товары — отрицательные
    ("The battery died after two days.", 0, "product", "en"),
    ("Cheap plastic that broke the first time I used it.", 0, "product", "en"),
    ("It stopped working after a week and the refund took forever.", 0, "product", "en"),
    ("The screen is dim and the speakers crackle.", 0, "product", "en"),
    ("Instructions were useless and two parts were missing.", 0, "product", "en"),
    ("This charger gets dangerously hot.", 0, "product", "en"),
    # отели — отрицательные
    ("The room smelled of smoke and the shower was broken.", 0, "hotel", "en"),
    ("Noisy street, thin walls and an uncomfortable bed.", 0, "hotel", "en"),
    ("The staff ignored our complaints for three days.", 0, "hotel", "en"),
    ("The photos online look nothing like the real hotel.", 0, "hotel", "en"),
    # сервисы — отрицательные
    ("The app crashes every time I try to log in.", 0, "service", "en"),
    ("Support never answered my emails.", 0, "service", "en"),
    ("My package arrived damaged and late.", 0, "service", "en"),
    ("This update made everything slower and more confusing.", 0, "service", "en"),
    ("The concert was too loud and the sound was muddy.", 0, "service", "en"),
    ("The book was dull and full of typos.", 0, "service", "en"),
    # отрицания, сарказм, смешанные оценки
    ("Not bad at all, I actually enjoyed it.", 1, "tricky", "en"),
    ("The movie was not good.", 0, "tricky", "en"),
    ("The food was not terrible, it was actually delicious.", 1, "tricky", "en"),
    ("Great, another hour waiting for a bus that never comes.", 0, "tricky", "en"),
    ("Oh wonderful, the app deleted all my photos.", 0, "tricky", "en"),
    ("I expected to be bored, but it turned out to be fantastic.", 1, "tricky", "en"),
    ("The first half was brilliant, but the second half was a disaster.", 0, "tricky", "en"),
    ("It's not the best phone ever, but for this price it's great.", 1, "tricky", "en"),
    ("Nothing special, just an average burger.", 0, "tricky", "en"),
    ("I can't recommend this place enough!", 1, "tricky", "en"),
    ("Never have I been so disappointed by a restaurant.", 0, "tricky", "en"),
    ("Hardly worth the money.", 0, "tricky", "en"),
    ("Without a doubt the most fun I've had all year.", 1, "tricky", "en"),
    ("The service could not have been better.", 1, "tricky", "en"),
    ("Wow, what a complete waste of money.", 0, "tricky", "en"),
    ("I wanted to like it, but it just didn't work.", 0, "tricky", "en"),
    # из ноутбука курса и курса Hugging Face
    ("I've been ready for a HuggingFace course my whole life.", 1, "notebook", "en"),
    ("I hate this huggingface so much!", 0, "notebook", "en"),
    ("I've been waiting for a HuggingFace course my whole life.", 1, "notebook", "en"),
    ("I hate this so much!", 0, "notebook", "en"),
    # русские отзывы — английская модель их «не понимает»
    ("Отличный фильм, всем советую!", 1, "russian", "ru"),
    ("Очень вкусно и недорого.", 1, "russian", "ru"),
    ("Прекрасный отель, обязательно вернёмся.", 1, "russian", "ru"),
    ("Курс понравился, всё понятно объяснено.", 1, "russian", "ru"),
    ("Ужасный сервис, больше не придём.", 0, "russian", "ru"),
    ("Скучный фильм, зря потратил время.", 0, "russian", "ru"),
    ("Телефон сломался через неделю.", 0, "russian", "ru"),
    ("Еда холодная, официант грубый.", 0, "russian", "ru"),
]
