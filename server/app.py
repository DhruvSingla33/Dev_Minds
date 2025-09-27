from flask import Flask, request, jsonify
import pandas as pd
import numpy as np
from sklearn.metrics.pairwise import cosine_similarity
from sklearn.feature_extraction.text import CountVectorizer
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

def load_data():
    books = pd.read_csv('Books.csv')
    ratings = pd.read_csv('Ratings.csv')
    
    ratings_with_name = ratings.merge(books, on='BookId')
    x = ratings_with_name.groupby('UserId').count()['Rating'] >= 0
    valid_users = x[x].index
    filtered_rating = ratings_with_name[ratings_with_name['UserId'].isin(valid_users)]

    y = filtered_rating.groupby('book_title').count()['Rating'] >= 0
    famous_books = y[y].index
    final_ratings = filtered_rating[filtered_rating['book_title'].isin(famous_books)]

    pt = final_ratings.pivot_table(index='book_title', columns='UserId', values='Rating')
    pt.fillna(0, inplace=True)
    return books, pt, cosine_similarity(pt)

@app.route('/')
def home():
    return "📚 Book Recommender API is running!"

@app.route('/books')
def get_books():
    books = pd.read_csv('Books.csv')
    return books[['book_title', 'book_author', 'Image-URL-M']].drop_duplicates().head(5).to_dict(orient='records')

@app.route('/recommend')
def recommend():
    book_name = request.args.get('book_name')
    if not book_name:
        return jsonify({'error': 'Missing book_name parameter'}), 400

    try:
        books, pt, similarity_scores = load_data()

        index = np.where(pt.index == book_name)[0][0]
        similar_items = sorted(
            list(enumerate(similarity_scores[index])),
            key=lambda x: x[1],
            reverse=True
        )[1:5]

        data = []
        for i in similar_items:
            temp_df = books[books['book_title'] == pt.index[i[0]]]
            book_info = temp_df.drop_duplicates('book_title')[['book_title', 'book_author', 'BookId']].values[0]
            data.append({
                'title': book_info[0],
                'author': book_info[1],
                'book_id': book_info[2]
            })

        return jsonify(data)

    except IndexError:
        return jsonify({'error': f'"{book_name}" not found in dataset'}), 404
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/recommend1')
def recommend1():
    book_name = request.args.get('book_name')
    if not book_name:
        return jsonify({"error": "Missing book_name parameter"}), 400

    try:
        books = pd.read_csv("Books.csv")
        books.fillna('', inplace=True)

        books["combined_features"] = books["book_title"]
        cv = CountVectorizer()
        count_matrix = cv.fit_transform(books["combined_features"])
        cosine_sim = cosine_similarity(count_matrix)

        book_index = books[books['book_title'] == book_name].index
        if book_index.empty:
            return jsonify({"error": "Book not found"}), 404

        book_index = book_index[0]
        similar_books = list(enumerate(cosine_sim[book_index]))
        sorted_similar_books = sorted(similar_books, key=lambda x: x[1], reverse=True)[1:11]

        results = []
        for i in sorted_similar_books:
            b = books.iloc[i[0]]
            results.append({
                "title": b['book_title'],
                "author": b['book_author'],
                "book_id": b['BookId']
            })

        return jsonify(results)

    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/hybrid_recommend')
def hybrid_recommend():
    book_name = request.args.get('book_name')
    if not book_name:
        return jsonify({'error': 'Missing book_name parameter'}), 400

    try:
        # Collaborative
        books, pt, similarity_scores = load_data()
        collab_results = []
        if book_name in pt.index:
            index = np.where(pt.index == book_name)[0][0]
            similar_items = sorted(
                list(enumerate(similarity_scores[index])),
                key=lambda x: x[1],
                reverse=True
            )[1:6]
            for i in similar_items:
                collab_results.append((pt.index[i[0]], i[1]))

        # Content-Based
        books_cb = pd.read_csv("Books.csv")
        books_cb.fillna('', inplace=True)
        books_cb["combined_features"] = books_cb["book_title"]
        cv = CountVectorizer()
        count_matrix = cv.fit_transform(books_cb["combined_features"])
        cosine_sim = cosine_similarity(count_matrix)

        cb_index = books_cb[books_cb["book_title"] == book_name].index
        if cb_index.empty:
            return jsonify({"error": "Book not found"}), 404

        cb_index = cb_index[0]
        content_results = []
        similar_books = list(enumerate(cosine_sim[cb_index]))
        sorted_similar_books = sorted(similar_books, key=lambda x: x[1], reverse=True)[1:6]
        for i in sorted_similar_books:
            content_results.append((books_cb.iloc[i[0]]["book_title"], i[1]))

        # Combine
        combined = {}
        for title, score in collab_results:
            combined[title] = combined.get(title, 0) + score * 0.6
        for title, score in content_results:
            combined[title] = combined.get(title, 0) + score * 0.4

        final_recommendations = sorted(combined.items(), key=lambda x: x[1], reverse=True)[:10]
        result = []
        for title, _ in final_recommendations:
            temp_df = books[books['book_title'] == title]
            if not temp_df.empty:
                row = temp_df.iloc[0]
                result.append({
                    'title': row['book_title'],
                    'author': row['book_author'],
                    'book_id': row['BookId']
                })

        return jsonify(result)

    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True)
